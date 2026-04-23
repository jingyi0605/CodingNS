# 远程访问概览

## 你不在 Host 旁边时，就会真的用到它

只要 Host 不在你当前设备旁边，远程访问就会成为日常使用的一部分。它让你在办公室外、出差途中、家里或手机上，继续访问同一台开发环境。

## 两条路都能走，但感觉不一样

### Tailscale

更适合你已经在使用 Tailscale，或者希望通过自己的私有网络在多设备之间互联。

### CodingNS Connect

更适合你想更直接地获得一个外部可访问入口，不想自己处理太多网络细节。

## 如果你只想先选一个

### 优先选 Tailscale 的情况

- 你已经有 Tailscale 账号和设备网络。
- 你更偏向私有网络访问。
- 你主要在自己的设备之间切换。

### 优先选 CodingNS Connect 的情况

- 你希望更快拿到外部访问地址。
- 你不想额外维护 Tailnet。
- 你更在意“能尽快从外面连上来”。

## 别一上来就把问题全堆到网络层

- 先在内网把 Host 和客户端跑通。
- 再开启远程访问，不要一开始就把问题堆在网络层。
- 只选择一种你最顺手的方式先跑通，后面再补另一种。

## 接下来直接看哪一页

- 看 Tailscale： [Tailscale 接入](/remote-access/tailscale-access)
- 看 CodingNS Connect： [CodingNS Connect](/remote-access/tunnel-service)
- 看使用建议： [安全与稳定建议](/remote-access/safe-access-tips)
