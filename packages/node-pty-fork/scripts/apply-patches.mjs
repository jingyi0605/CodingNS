import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function detectEol(text) {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

function normalize(text) {
  return text.replace(/\r\n/g, "\n");
}

function applyExactReplacements(filePath, replacements) {
  const original = fs.readFileSync(filePath, "utf8");
  const eol = detectEol(original);
  let normalized = normalize(original);

  for (const replacement of replacements) {
    if (!normalized.includes(replacement.from)) {
      throw new Error(`未找到预期片段：${filePath}${"\n"}${replacement.label}`);
    }
    normalized = normalized.replace(replacement.from, replacement.to);
  }

  fs.writeFileSync(filePath, normalized.replace(/\n/g, eol), "utf8");
  console.log(`[codingns-node-pty] 已写回 fork 覆盖：${path.relative(packageRoot, filePath)}`);
}

applyExactReplacements(path.join(packageRoot, "src", "win", "conpty.cc"), [
  {
    label: "conpty typedef guard",
    from: `// Taken from the RS5 Windows SDK, but redefined here in case we're targeting <= 17134
#ifndef PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE
#define PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE \\
  ProcThreadAttributeValue(22, FALSE, TRUE, FALSE)

typedef VOID* HPCON;
typedef HRESULT (__stdcall *PFNCREATEPSEUDOCONSOLE)(COORD c, HANDLE hIn, HANDLE hOut, DWORD dwFlags, HPCON* phpcon);
typedef HRESULT (__stdcall *PFNRESIZEPSEUDOCONSOLE)(HPCON hpc, COORD newSize);
typedef HRESULT (__stdcall *PFNCLEARPSEUDOCONSOLE)(HPCON hpc);
typedef void (__stdcall *PFNCLOSEPSEUDOCONSOLE)(HPCON hpc);

#endif
`,
    to: `// Taken from the RS5 Windows SDK, but redefined here in case we're targeting <= 17134.
#ifndef PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE
#define PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE \\
  ProcThreadAttributeValue(22, FALSE, TRUE, FALSE)
#endif

#ifndef _HPCON_DEFINED
typedef VOID* HPCON;
#endif

typedef HRESULT (__stdcall *PFNCREATEPSEUDOCONSOLE)(COORD c, HANDLE hIn, HANDLE hOut, DWORD dwFlags, HPCON* phpcon);
typedef HRESULT (__stdcall *PFNRESIZEPSEUDOCONSOLE)(HPCON hpc, COORD newSize);
typedef HRESULT (__stdcall *PFNCLEARPSEUDOCONSOLE)(HPCON hpc);
typedef void (__stdcall *PFNCLOSEPSEUDOCONSOLE)(HPCON hpc);
`
  }
]);

applyExactReplacements(path.join(packageRoot, "src", "win", "winpty.cc"), [
  {
    label: "winpty locals hoist",
    from: `static NAN_METHOD(PtyStartProcess) {
  Nan::HandleScope scope;

  if (info.Length() != 7 ||
`,
    to: `static NAN_METHOD(PtyStartProcess) {
  Nan::HandleScope scope;

  std::stringstream why;
  const wchar_t *filename = nullptr;
  const wchar_t *cmdline = nullptr;
  const wchar_t *cwd = nullptr;
  std::wstring env;
  int cols = 0;
  int rows = 0;
  bool debug = false;
  winpty_error_ptr_t error_ptr = nullptr;
  winpty_config_t* winpty_config = nullptr;
  winpty_t *pc = nullptr;
  winpty_spawn_config_t* config = nullptr;
  HANDLE handle = nullptr;
  BOOL spawnSuccess = FALSE;
  v8::Local<v8::Object> marshal = Nan::New<v8::Object>();

  if (info.Length() != 7 ||
`
  },
  {
    label: "winpty filename/cmdline/cwd assignment",
    from: `  std::stringstream why;

  const wchar_t *filename = path_util::to_wstring(Nan::Utf8String(info[0]));
  const wchar_t *cmdline = path_util::to_wstring(Nan::Utf8String(info[1]));
  const wchar_t *cwd = path_util::to_wstring(Nan::Utf8String(info[3]));

  // create environment block
  std::wstring env;
`,
    to: `  filename = path_util::to_wstring(Nan::Utf8String(info[0]));
  cmdline = path_util::to_wstring(Nan::Utf8String(info[1]));
  cwd = path_util::to_wstring(Nan::Utf8String(info[3]));

  // create environment block
`
  },
  {
    label: "winpty primitive locals assignment",
    from: `  int cols = info[4]->Int32Value(Nan::GetCurrentContext()).FromJust();
  int rows = info[5]->Int32Value(Nan::GetCurrentContext()).FromJust();
  bool debug = Nan::To<bool>(info[6]).FromJust();
`,
    to: `  cols = info[4]->Int32Value(Nan::GetCurrentContext()).FromJust();
  rows = info[5]->Int32Value(Nan::GetCurrentContext()).FromJust();
  debug = Nan::To<bool>(info[6]).FromJust();
`
  },
  {
    label: "winpty config hoist",
    from: `  // Create winpty config
  winpty_error_ptr_t error_ptr = nullptr;
  winpty_config_t* winpty_config = winpty_config_new(0, &error_ptr);
`,
    to: `  // Create winpty config
  winpty_config = winpty_config_new(0, &error_ptr);
`
  },
  {
    label: "winpty pc hoist",
    from: `  // Start the pty agent
  winpty_t *pc = winpty_open(winpty_config, &error_ptr);
`,
    to: `  // Start the pty agent
  pc = winpty_open(winpty_config, &error_ptr);
`
  },
  {
    label: "winpty spawn config hoist",
    from: `  // Create winpty spawn config
  winpty_spawn_config_t* config = winpty_spawn_config_new(WINPTY_SPAWN_FLAG_AUTO_SHUTDOWN, shellpath.c_str(), cmdline, cwd, env.c_str(), &error_ptr);
`,
    to: `  // Create winpty spawn config
  config = winpty_spawn_config_new(WINPTY_SPAWN_FLAG_AUTO_SHUTDOWN, shellpath.c_str(), cmdline, cwd, env.c_str(), &error_ptr);
`
  },
  {
    label: "winpty handle/spawnSuccess hoist",
    from: `  // Spawn the new process
  HANDLE handle = nullptr;
  BOOL spawnSuccess = winpty_spawn(pc, config, &handle, nullptr, nullptr, &error_ptr);
`,
    to: `  // Spawn the new process
  spawnSuccess = winpty_spawn(pc, config, &handle, nullptr, nullptr, &error_ptr);
`
  },
  {
    label: "winpty marshal hoist",
    from: `  // Set return values
  v8::Local<v8::Object> marshal = Nan::New<v8::Object>();
`,
    to: `  // Set return values
`
  }
]);
