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

如果你准备在 Linux 上手动用 `npm install -g` 安装，建议先把编译工具一起装好。  
CodingNS 依赖 `better-sqlite3` 这类原生模块，遇到拿不到预编译包时，会自动退回本机编译。

```bash
apt-get update
apt-get install -y build-essential python3
```

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
