---
title: Python 模块与包：import、__init__.py 与标准库
slug: python-modules-packages
summary: 从 import 的四种写法、包的结构与 __init__.py，到 __name__ 程序入口和常用标准库，搞懂 Python 代码是怎么组织、复用的。
tags: [Python, 模块, import, 包管理]
section: 学习笔记
topic: Python
subtopic: ""
published: true
---

代码写到几百行，把所有东西塞进一个文件就难维护了。Python 的解法是**模块（module）**：把相关代码拆到一个 `.py` 文件里，用 `import` 引进来复用。模块再往上组织成**包（package）**。这套机制是大模型应用开发的基础——`import openai`、`import langchain`、`import numpy`，本质上都是同一件事。

## 为什么需要模块

没有模块时，写一次工具函数就要复制粘贴一次，改了 A 处忘了改 B 处。有了模块，把 `utils.py` 写好，谁用谁 `import`，一份代码处处复用。模块还带来一个隐藏好处：**命名空间隔离**——两个模块里的同名函数互不干扰。

## import 的四种写法

假设有一个 `math_utils.py`：

```python
# math_utils.py
PI = 3.14159

def add(a, b):
    return a + b
```

四种引入方式：

```python
import math_utils                    # 方式一：导入整个模块
math_utils.add(1, 2)                 # 用的时候带模块名前缀

from math_utils import add           # 方式二：只导入需要的函数
add(1, 2)                            # 直接调用，不用前缀

from math_utils import add as my_add # 方式三：起别名，避免重名
my_add(1, 2)

from math_utils import *             # 方式四：全部导入（不推荐）
add(1, 2)                            # 污染命名空间，容易重名
```

四种里最推荐**方式一**（清晰，一眼看出函数来自哪）和**方式二**（只导需要的）。`import *` 会把模块里所有名字都倒进当前命名空间，极易和现有名字撞车，尽量别用。

## 包与 __init__.py

**包（package）** 是「装模块的目录」，让结构更清晰。一个包就是一个带 `__init__.py` 的目录：

```
my_project/
├── main.py              # 入口脚本
├── utils/               # 这是一个包
│   ├── __init__.py      # 包的标识文件（可以为空）
│   ├── text.py
│   └── db.py
└── models/              # 这是另一个包
    └── __init__.py
```

导入包里的模块，用「点」表示层级：

```python
from utils import text           # 导入 utils 包里的 text 模块
from utils.db import connect     # 导入 utils.db 模块里的 connect 函数
```

`__init__.py` 的作用有两个：一是标记这个目录是个包（Python 3.3+ 其实可以省略，但保留是惯例）；二是包被导入时先执行它，可以在这里放初始化代码，或用 `__all__` 控制 `import *` 导出哪些名字。

## __name__ 与程序入口

这是 Python 里最常见、也最容易被忽略的一行代码：

```python
# script.py
def main():
    print("程序开始")

if __name__ == "__main__":
    main()
```

它的意义在于区分「被直接运行」和「被 import」。每个模块都有个内置变量 `__name__`：

- 直接运行 `python script.py` 时，`__name__` 的值是 `"__main__"`
- 被 `import script` 时，`__name__` 的值是 `"script"`

所以 `if __name__ == "__main__"` 里的代码，只在「直接运行」时执行，被 import 时不会跑。这有两个好处：导入模块不会顺带执行测试代码；同一个文件既能当脚本跑，又能被别的文件复用。

## 绝对导入 vs 相对导入

包内部模块之间互相引用，有两种写法。

**绝对导入**：从包的根目录出发写全路径，清晰、不易错，推荐：

```python
# utils/db.py 里引用 utils/text.py
from utils.text import clean_text
```

**相对导入**：用 `.` 表示「当前包」、`..` 表示「上一级」，只用于包内部：

```python
# utils/db.py 里引用同包下的 text.py
from .text import clean_text      # 一个点 = 当前包
from ..models.user import User    # 两个点 = 上一级
```

相对导入的优点是包整体改名或移动时不用改路径，缺点是只能在包内部用（顶层脚本不能用相对导入）。实际项目里绝对导入更常见。

## 常用标准库速查

Python 自带一大批「标准库」，开箱即用，不用 pip 安装。大模型应用开发里最常用的几个：

| 模块 | 用途 | 典型用法 |
|---|---|---|
| os / pathlib | 路径、文件系统操作 | `Path("data/input.txt").read_text()` |
| json | JSON 解析与序列化 | `json.loads(resp.text)` |
| datetime | 日期时间 | `datetime.now()` |
| time | 时间戳、休眠 | `time.sleep(1)` |
| random | 随机数 | `random.randint(1, 10)` |
| re | 正则表达式 | `re.search(r"\d+", text)` |
| collections | 高级容器 | `defaultdict(list)` |
| typing | 类型标注 | `def f(x: int) -> str` |

重点提两个大模型场景里的高频用法：

**json** 几乎出现在每一次 LLM 交互里——解析接口返回、构造请求体：

```python
import json

resp = call_llm(...)                 # 模型返回的字符串
data = json.loads(resp)              # 字符串 → dict/list
print(data["choices"][0]["message"]["content"])
```

**pathlib** 是处理文件路径的现代方式，比 `os` 更优雅：

```python
from pathlib import Path

for doc in Path("docs").glob("*.md"):   # 遍历 docs 下所有 md 文件
    content = doc.read_text(encoding="utf-8")
    print(content[:50])
```

## pip 与第三方库

标准库之外的能力，靠 `pip` 安装第三方库。大模型应用开发最常用的几个：

```bash
pip install openai          # OpenAI 接口
pip install langchain       # LLM 应用框架
pip install numpy pandas    # 数据处理
pip install pydantic        # 数据校验 / 结构化输出
```

几个好习惯：

1. **用虚拟环境隔离依赖**，别把库装到全局污染环境
2. **记录依赖版本**，`pip freeze > requirements.txt` 或 `pyproject.toml`，换机器一键还原
3. **换国内镜像源加速**，避免下载超时

导入第三方库和导入自己的模块、标准库完全一样，都是一个 `import`：

```python
from openai import OpenAI
import numpy as np

client = OpenAI()          # 第三方库
arr = np.array([1, 2, 3])  # 第三方库，起了别名 np
```

## 小结

1. **模块**是 `.py` 文件，用 `import` 复用，带来命名空间隔离
2. **包**是带 `__init__.py` 的目录，用「点」表示层级关系
3. **`if __name__ == "__main__"`** 区分「直接运行」和「被导入」，脚本和模块二合一
4. **导入优先用绝对导入**，`import *` 能不用就不用
5. **标准库**（json、pathlib、datetime）开箱即用，**第三方库**（openai、langchain）靠 pip 装

大模型应用开发的代码里，`import` 是最日常的一行——理解模块机制，看任何开源项目的目录结构都不会再发怵。
