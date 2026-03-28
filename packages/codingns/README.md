# @jingyi0605/codingns

`@jingyi0605/codingns` 是项目的第一版统一服务包。

安装名是 `@jingyi0605/codingns`，实际命令仍然是 `codingns`。

安装后可以直接启动完整服务，不需要再分别启动前端和后端：

```bash
npx @jingyi0605/codingns start --port 3002
```

或者：

```bash
npm install -g @jingyi0605/codingns
codingns start --port 3002
```

常用参数：

- `--host`：监听地址，默认 `0.0.0.0`
- `--port`：监听端口，默认 `3002`
- `--data-dir`：数据目录，默认 `~/.codingns`
