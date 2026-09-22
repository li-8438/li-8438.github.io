---
title: Python 网络编程：Socket 与 TCP/UDP
slug: python-socket
summary: 用 socket 写 TCP 和 UDP 的客户端、服务端，理解三次握手、字节流收发，再串联一个「TCP 中转 Ollama」的实战。
tags: [Python, Socket, 网络编程]
section: 学习笔记
topic: Python
subtopic: ""
published: true
---

网络编程要理解三个概念：**协议**（TCP/UDP，怎么传）、**IP**（网络里计算机的唯一标识，传给谁）、**端口号**（计算机里程序的标识，交给哪个程序）。Python 用内置的 `socket` 模块就能直接写客户端和服务端。

## TCP 与 UDP

TCP 面向连接、可靠、基于字节流，像打电话——先建立连接再通话，保证对方收到。UDP 面向无连接、不可靠，像寄明信片——直接发出去，不保证送达，但开销小、速度快。

## TCP 客户端

一个 TCP 客户端的标准步骤：

```python
import socket

tcp_client = socket.socket()                 # 1. 创建客户端
tcp_client.connect(("127.0.0.1", 10086))     # 2. 连接服务端 (ip, 端口)

message = input("请输入聊天内容：")
tcp_client.send(message.encode("utf-8"))     # 3. 发送消息（要转成字节）

data = tcp_client.recv(1024)                 # 4. 接收服务端响应（阻塞）
print(data.decode("utf-8"))                  # 5. 字节再转回文字

tcp_client.close()                           # 6. 关闭连接
```

注意：`send` 发的是字节，`recv` 收的也是字节，所以发送要 `encode`，接收要 `decode`。

## TCP 服务端

服务端比客户端多两步：绑定地址、监听连接：

```python
import socket

server = socket.socket()
server.bind(("127.0.0.1", 10086))                       # 1. 绑定 ip + 端口
server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, True)  # 端口复用
server.listen(10)                                        # 2. 监听，最多排队 10 个

while True:
    client, address = server.accept()    # 3. 接入客户端（阻塞）
    client.send("欢迎加入聊天室~".encode("utf-8"))
    data = client.recv(1024)             # 4. 接收消息
    print(address, data.decode("utf-8"))
    client.close()                       # 5. 关闭与这个客户端的连接
```

`accept()` 是阻塞的——没有客户端连进来，代码就停在这一行等。它返回一个「专门服务这个客户端」的新 socket 和对方的地址。

一个形象的类比：服务端像食堂，`bind` 是选商场和档口，`listen` 是定最大窗口数，`accept` 是开窗等顾客，`send`/`recv` 是交易，`close` 是打烊。

## UDP

UDP 用 `sendto` 直接发，不建连接。一个典型用途是局域网广播消息：

```python
import socket

udp_client = socket.socket(type=socket.SOCK_DGRAM)   # 指定 UDP
message = "你好"
# 发给 (ip, 端口)，用 255 结尾的广播地址可以群发
udp_client.sendto(message.encode("gbk"), ("192.168.14.255", 2425))
```

对比：TCP 是 `connect` + `send`，UDP 是直接 `sendto`，省去了建立连接的开销。

## 案例：TCP 中转 Ollama

一个把网络编程和大模型串起来的实战——客户端通过 TCP 提问，服务端收到后转给本地的 Ollama，再把大模型的回答原路返回：

```python
import socket
import ollama

server = socket.socket()
server.bind(("127.0.0.1", 10086))
server.listen(10)

chat_client, address = server.accept()
question = chat_client.recv(1024).decode("utf-8")
print(f"收到问题：{question}")

# 中转给本地 Ollama
ollama_client = ollama.Client(host="127.0.0.1:11434")
reply = ollama_client.chat(
    model="deepseek-r1:1.5b",
    messages=[{"role": "user", "content": question}],
)
answer = reply.message.content

chat_client.send(answer.encode("utf-8"))   # 把回答发回客户端
chat_client.close()
server.close()
```

这个案例的价值在于：它把「网络收发」和「模型调用」拆成了两件事，服务端只是中间的「搬运工」，这正是微服务里最常见的中转模式。

## 小结

网络编程的骨架就是「创建 socket → 连接/绑定 → 收发字节 → 关闭」。TCP 重可靠（连接、字节流），UDP 重轻快（无连接、直接发）。记住「字节流的编解码」和「服务端 accept 是阻塞的」这两个点，写基本的客户端服务端就不难了。下一篇讲正则表达式，它常和网络编程搭档——抓取网页里的内容。
