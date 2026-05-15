# 安装 Host 服务

请先在一台准备长期使用的设备上安装 CodingNS Host。  
桌面端、手机和浏览器后续都会连接到这台 Host。

## 安装方式

如果你只是想尽快装好、少记命令，直接用 `curl` 快速安装。  
如果你更喜欢自己一步步确认，也可以手动用 `npm + PM2` 安装。

### 选择建议

- 希望快速完成安装，选 `curl` 快速安装。
- 想自己掌控每一步，选手动 `npm + PM2` 安装。

## 开始前只要确认两件事

开始前，先确认这台机器已经装好：

- Node.js `22` 或更高版本
- npm `10` 或更高版本

CodingNS 依赖 `better-sqlite3`、`node-pty` 这类原生模块。  
如果 npm 没拿到预编译包，就会自动退回本机编译，所以不同系统的前置条件不一样。

Linux 上建议先装编译工具：

```bash
apt-get update
apt-get install -y build-essential python3
```

Windows 上如果你准备用 `npm install -g` 或安装脚本，建议先确认这两件事：

- 优先使用 Node.js `22 LTS`
- 已安装 Visual Studio Build Tools 2022，并勾选 `Desktop development with C++`

这是因为 Windows 上原生模块的预编译包通常从 GitHub Releases 下载。  
一旦下载失败，npm 就会回退到 `node-gyp` 本机编译；这时候如果没有 C++ Build Tools，安装一定失败。  
只切换 npm 源，解决不了这类问题。

如果这台机器以后准备长期运行，建议将它作为常驻 Host 使用，方便后续在其他设备上继续访问。

## 使用 CURL 安装

这是最直接的安装方式。执行一条命令后，按提示完成配置即可。

```bash
curl -fsSL https://codingns.com/install | bash
```

运行后，安装脚本会依次问你这些内容：

- 服务端口
  默认是 `3002`
- 数据保存目录
  默认是 `~/.codingns`
- 是否启用开机自动启动
  默认会帮你打开

脚本还会自动完成这些步骤：

- 先检查 Node.js、npm 和必需的编译工具
- 在支持的系统上，缺什么就先询问你是否自动安装
- 检查当前机器上已经装了哪些受支持的 CLI
- 如果官方 npm 源暂时不可用，自动切到国内镜像继续安装
- 安装 `@jingyi0605/codingns`
- 安装 `pm2`
- 用 `pm2` 把 Host 托管起来
- 在支持的系统上配置开机自动启动

如果你在 Windows 上运行脚本，它会提示你检查 Visual Studio Build Tools。  
这一项目前不会自动替你安装，因为自动装完整 C++ 工具链又慢又脆，失败时还更难排查。

### 安装完成后

正常完成后，你会看到：

- Host 访问地址
- 数据保存目录
- `pm2` 常用命令提示

这时候通常就已经可以继续下一步去连接客户端了。

## 手动安装

如果你想把每一步都自己确认一遍，可以按下面的顺序来。

### 第一步：安装 CodingNS

如果你在 Linux 上手动安装，先执行：

```bash
apt-get update
apt-get install -y build-essential python3
```

然后再执行：

```bash
npm install -g @jingyi0605/codingns
```

如果你在 Windows 上手动安装，先确认：

- `node -v` 最好是 `v22.x`
- 已安装 Visual Studio Build Tools 2022，并勾选 `Desktop development with C++`

再执行：

```bash
npm install -g @jingyi0605/codingns
```

### 第二步：先手工启动一次

先启动一次，确认服务可以正常运行：

```bash
codingns start --host 0.0.0.0 --port 3002 --data-dir ~/.codingns
```

这一步建议你重点确认两件事：

- 浏览器打开 `http://127.0.0.1:3002/` 能看到页面
- 你自己选的端口和数据目录都符合预期

如果只是先试一试，做到这里也可以。  
如果你想让它长期稳定运行，继续下一步把它交给 `PM2`。

### 第三步：安装 PM2

```bash
npm install -g pm2
```

### 第四步：交给 PM2 托管

```bash
pm2 start "$(which codingns)" --name codingns -- start --host 0.0.0.0 --port 3002 --data-dir ~/.codingns
```

这一步做完后，Host 就不需要一直占着当前终端窗口了。

### 第五步：保存并开启开机自动启动

先保存当前进程列表：

```bash
pm2 save
```

然后生成开机自动启动配置：

```bash
pm2 startup
```

执行完 `pm2 startup` 输出的那条系统命令后，再执行一次：

```bash
pm2 save
```

这样以后机器重启后，Host 也会跟着自动起来。

## 端口与数据目录

### 端口

默认端口是 `3002`。  
如果这台机器上 `3002` 已经被别的程序占用了，你可以换成别的端口，比如：

```bash
codingns start --port 3300
```

或者：

```bash
pm2 start "$(which codingns)" --name codingns -- start --host 0.0.0.0 --port 3300 --data-dir ~/.codingns
```

### 数据保存目录

默认会放到：

```bash
~/.codingns
```

如果你更希望把数据放到单独的位置，也可以自己指定，比如：

```bash
codingns start --data-dir /var/lib/codingns
```

## 下一步

接下来直接看 [连接客户端](/quick-install/client-connection)。  
连上之后，你会进入初始化或登录流程，再接着去 [首次登录与开始使用](/quick-install/first-login)。

## 常见失败原因

### Windows 上看到 `Could not find any Visual Studio installation to use`

这不是 CodingNS 自己的业务错误，就是本机缺少 C++ 编译工具。  
安装 Visual Studio Build Tools 2022，并勾选 `Desktop development with C++`，然后重试。

### Windows 上看到 `prebuild-install warn install read ECONNRESET` 或 `Request timed out`

这通常表示原生模块从 GitHub Releases 下载预编译包失败。  
它和 npm 官方源、镜像源不是一回事，所以单纯切换 npm registry 往往没用。

遇到这种情况，优先按下面顺序处理：

1. 改用 Node.js `22 LTS`
2. 装好 Visual Studio Build Tools 2022，让 npm 至少还能回退到本机编译
3. 再重新执行安装
