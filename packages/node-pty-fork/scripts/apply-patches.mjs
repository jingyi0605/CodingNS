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
    if (normalized.includes(replacement.to)) {
      console.log(`[codingns-node-pty] 已是目标内容，跳过：${path.relative(packageRoot, filePath)} (${replacement.label})`);
      continue;
    }
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
    label: "winpty PtyStartProcess full sync",
    from: `static NAN_METHOD(PtyStartProcess) {
  Nan::HandleScope scope;

  if (info.Length() != 7 ||
      !info[0]->IsString() ||
      !info[1]->IsString() ||
      !info[2]->IsArray() ||
      !info[3]->IsString() ||
      !info[4]->IsNumber() ||
      !info[5]->IsNumber() ||
      !info[6]->IsBoolean()) {
    Nan::ThrowError("Usage: pty.startProcess(file, cmdline, env, cwd, cols, rows, debug)");
    return;
  }

  std::stringstream why;

  const wchar_t *filename = path_util::to_wstring(Nan::Utf8String(info[0]));
  const wchar_t *cmdline = path_util::to_wstring(Nan::Utf8String(info[1]));
  const wchar_t *cwd = path_util::to_wstring(Nan::Utf8String(info[3]));

  // create environment block
  std::wstring env;
  const v8::Local<v8::Array> envValues = v8::Local<v8::Array>::Cast(info[2]);
  if (!envValues.IsEmpty()) {

    std::wstringstream envBlock;

    for(uint32_t i = 0; i < envValues->Length(); i++) {
      std::wstring envValue(path_util::to_wstring(Nan::Utf8String(Nan::Get(envValues, i).ToLocalChecked())));
      envBlock << envValue << L'\\0';
    }

    env = envBlock.str();
  }

  // use environment 'Path' variable to determine location of
  // the relative path that we have recieved (e.g cmd.exe)
  std::wstring shellpath;
  if (::PathIsRelativeW(filename)) {
    shellpath = path_util::get_shell_path(filename);
  } else {
    shellpath = filename;
  }

  std::string shellpath_(shellpath.begin(), shellpath.end());

  if (shellpath.empty() || !path_util::file_exists(shellpath)) {
    why << "File not found: " << shellpath_;
    Nan::ThrowError(why.str().c_str());
    goto cleanup;
  }

  int cols = info[4]->Int32Value(Nan::GetCurrentContext()).FromJust();
  int rows = info[5]->Int32Value(Nan::GetCurrentContext()).FromJust();
  bool debug = Nan::To<bool>(info[6]).FromJust();

  // Enable/disable debugging
  SetEnvironmentVariable(WINPTY_DBG_VARIABLE, debug ? "1" : NULL); // NULL = deletes variable

  // Create winpty config
  winpty_error_ptr_t error_ptr = nullptr;
  winpty_config_t* winpty_config = winpty_config_new(0, &error_ptr);
  if (winpty_config == nullptr) {
    throw_winpty_error("Error creating WinPTY config", error_ptr);
    goto cleanup;
  }
  winpty_error_free(error_ptr);

  // Set pty size on config
  winpty_config_set_initial_size(winpty_config, cols, rows);

  // Start the pty agent
  winpty_t *pc = winpty_open(winpty_config, &error_ptr);
  winpty_config_free(winpty_config);
  if (pc == nullptr) {
    throw_winpty_error("Error launching WinPTY agent", error_ptr);
    goto cleanup;
  }
  winpty_error_free(error_ptr);

  // Save pty struct for later use
  ptyHandles.insert(ptyHandles.end(), pc);

  // Create winpty spawn config
  winpty_spawn_config_t* config = winpty_spawn_config_new(WINPTY_SPAWN_FLAG_AUTO_SHUTDOWN, shellpath.c_str(), cmdline, cwd, env.c_str(), &error_ptr);
  if (config == nullptr) {
    throw_winpty_error("Error creating WinPTY spawn config", error_ptr);
    goto cleanup;
  }
  winpty_error_free(error_ptr);

  // Spawn the new process
  HANDLE handle = nullptr;
  BOOL spawnSuccess = winpty_spawn(pc, config, &handle, nullptr, nullptr, &error_ptr);
  winpty_spawn_config_free(config);
  if (!spawnSuccess) {
    throw_winpty_error("Unable to start terminal process", error_ptr);
    goto cleanup;
  }
  winpty_error_free(error_ptr);

  // Set return values
  v8::Local<v8::Object> marshal = Nan::New<v8::Object>();
  Nan::Set(marshal, Nan::New<v8::String>("innerPid").ToLocalChecked(), Nan::New<v8::Number>((int)GetProcessId(handle)));
  Nan::Set(marshal, Nan::New<v8::String>("innerPidHandle").ToLocalChecked(), Nan::New<v8::Number>((int)handle));
  Nan::Set(marshal, Nan::New<v8::String>("pid").ToLocalChecked(), Nan::New<v8::Number>((int)winpty_agent_process(pc)));
  Nan::Set(marshal, Nan::New<v8::String>("pty").ToLocalChecked(), Nan::New<v8::Number>(InterlockedIncrement(&ptyCounter)));
  Nan::Set(marshal, Nan::New<v8::String>("fd").ToLocalChecked(), Nan::New<v8::Number>(-1));
  {
    LPCWSTR coninPipeName = winpty_conin_name(pc);
    std::wstring coninPipeNameWStr(coninPipeName);
    std::string coninPipeNameStr(coninPipeNameWStr.begin(), coninPipeNameWStr.end());
    Nan::Set(marshal, Nan::New<v8::String>("conin").ToLocalChecked(), Nan::New<v8::String>(coninPipeNameStr).ToLocalChecked());
    LPCWSTR conoutPipeName = winpty_conout_name(pc);
    std::wstring conoutPipeNameWStr(conoutPipeName);
    std::string conoutPipeNameStr(conoutPipeNameWStr.begin(), conoutPipeNameWStr.end());
    Nan::Set(marshal, Nan::New<v8::String>("conout").ToLocalChecked(), Nan::New<v8::String>(conoutPipeNameStr).ToLocalChecked());
  }
  info.GetReturnValue().Set(marshal);

  goto cleanup;

cleanup:
  delete filename;
  delete cmdline;
  delete cwd;
}
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
      !info[0]->IsString() ||
      !info[1]->IsString() ||
      !info[2]->IsArray() ||
      !info[3]->IsString() ||
      !info[4]->IsNumber() ||
      !info[5]->IsNumber() ||
      !info[6]->IsBoolean()) {
    Nan::ThrowError("Usage: pty.startProcess(file, cmdline, env, cwd, cols, rows, debug)");
    return;
  }

  filename = path_util::to_wstring(Nan::Utf8String(info[0]));
  cmdline = path_util::to_wstring(Nan::Utf8String(info[1]));
  cwd = path_util::to_wstring(Nan::Utf8String(info[3]));

  // create environment block
  const v8::Local<v8::Array> envValues = v8::Local<v8::Array>::Cast(info[2]);
  if (!envValues.IsEmpty()) {

    std::wstringstream envBlock;

    for(uint32_t i = 0; i < envValues->Length(); i++) {
      std::wstring envValue(path_util::to_wstring(Nan::Utf8String(Nan::Get(envValues, i).ToLocalChecked())));
      envBlock << envValue << L'\\0';
    }

    env = envBlock.str();
  }

  // use environment 'Path' variable to determine location of
  // the relative path that we have recieved (e.g cmd.exe)
  std::wstring shellpath;
  if (::PathIsRelativeW(filename)) {
    shellpath = path_util::get_shell_path(filename);
  } else {
    shellpath = filename;
  }

  std::string shellpath_(shellpath.begin(), shellpath.end());

  if (shellpath.empty() || !path_util::file_exists(shellpath)) {
    why << "File not found: " << shellpath_;
    Nan::ThrowError(why.str().c_str());
    goto cleanup;
  }

  cols = info[4]->Int32Value(Nan::GetCurrentContext()).FromJust();
  rows = info[5]->Int32Value(Nan::GetCurrentContext()).FromJust();
  debug = Nan::To<bool>(info[6]).FromJust();

  // Enable/disable debugging
  SetEnvironmentVariable(WINPTY_DBG_VARIABLE, debug ? "1" : NULL); // NULL = deletes variable

  // Create winpty config
  winpty_config = winpty_config_new(0, &error_ptr);
  if (winpty_config == nullptr) {
    throw_winpty_error("Error creating WinPTY config", error_ptr);
    goto cleanup;
  }
  winpty_error_free(error_ptr);

  // Set pty size on config
  winpty_config_set_initial_size(winpty_config, cols, rows);

  // Start the pty agent
  pc = winpty_open(winpty_config, &error_ptr);
  winpty_config_free(winpty_config);
  if (pc == nullptr) {
    throw_winpty_error("Error launching WinPTY agent", error_ptr);
    goto cleanup;
  }
  winpty_error_free(error_ptr);

  // Save pty struct for later use
  ptyHandles.insert(ptyHandles.end(), pc);

  // Create winpty spawn config
  config = winpty_spawn_config_new(WINPTY_SPAWN_FLAG_AUTO_SHUTDOWN, shellpath.c_str(), cmdline, cwd, env.c_str(), &error_ptr);
  if (config == nullptr) {
    throw_winpty_error("Error creating WinPTY spawn config", error_ptr);
    goto cleanup;
  }
  winpty_error_free(error_ptr);

  // Spawn the new process
  spawnSuccess = winpty_spawn(pc, config, &handle, nullptr, nullptr, &error_ptr);
  winpty_spawn_config_free(config);
  if (!spawnSuccess) {
    throw_winpty_error("Unable to start terminal process", error_ptr);
    goto cleanup;
  }
  winpty_error_free(error_ptr);

  // Set return values
  Nan::Set(marshal, Nan::New<v8::String>("innerPid").ToLocalChecked(), Nan::New<v8::Number>((int)GetProcessId(handle)));
  Nan::Set(marshal, Nan::New<v8::String>("innerPidHandle").ToLocalChecked(), Nan::New<v8::Number>((int)handle));
  Nan::Set(marshal, Nan::New<v8::String>("pid").ToLocalChecked(), Nan::New<v8::Number>((int)winpty_agent_process(pc)));
  Nan::Set(marshal, Nan::New<v8::String>("pty").ToLocalChecked(), Nan::New<v8::Number>(InterlockedIncrement(&ptyCounter)));
  Nan::Set(marshal, Nan::New<v8::String>("fd").ToLocalChecked(), Nan::New<v8::Number>(-1));
  {
    LPCWSTR coninPipeName = winpty_conin_name(pc);
    std::wstring coninPipeNameWStr(coninPipeName);
    std::string coninPipeNameStr(coninPipeNameWStr.begin(), coninPipeNameWStr.end());
    Nan::Set(marshal, Nan::New<v8::String>("conin").ToLocalChecked(), Nan::New<v8::String>(coninPipeNameStr).ToLocalChecked());
    LPCWSTR conoutPipeName = winpty_conout_name(pc);
    std::wstring conoutPipeNameWStr(conoutPipeName);
    std::string conoutPipeNameStr(conoutPipeNameWStr.begin(), conoutPipeNameWStr.end());
    Nan::Set(marshal, Nan::New<v8::String>("conout").ToLocalChecked(), Nan::New<v8::String>(conoutPipeNameStr).ToLocalChecked());
  }
  info.GetReturnValue().Set(marshal);

  goto cleanup;

cleanup:
  delete filename;
  delete cmdline;
  delete cwd;
}
`
  }
]);
