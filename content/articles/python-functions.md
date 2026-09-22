---
title: Python 函数：从定义到 lambda 与递归
slug: python-functions
summary: 把一段逻辑封装成可复用的函数，理清参数、返回值、作用域，再进阶到匿名函数与递归。
tags: [Python, 函数, 入门]
section: 学习笔记
topic: Python
subtopic: ""
published: true
---

函数是「封装」的最小单位：把一段反复用到的逻辑打包，起个名字，之后调用名字即可。它是从「写脚本」走向「写程序」的分水岭。本文从定义、参数、返回值讲到作用域，最后收在 lambda 和递归这两个进阶点上。

## 为什么要函数

写函数有两个直接好处：一是**复用**，同样的逻辑不用抄三遍；二是**分层**，把复杂问题拆成一个个有名字的小步骤，读代码的人一眼就能看懂整体结构。

## 定义与调用

```python
def greet():
    print("你好")

greet()   # 调用：函数名加括号
```

Python 内置了大量函数（`print`、`input`、`int`、`float`、`type` 等），但真正有价值的是自定义函数。按「有没有参数、有没有返回值」能分成四类：

```python
def f1():          # 无参无返回值
    pass

def f2(x, y):      # 有参无返回值
    print(x + y)

def f3():          # 无参有返回值
    return 42

def f4(x, y):      # 有参有返回值（最终形态）
    return x + y
```

## 参数

定义时的参数叫形参，调用时传的叫实参，个数和位置要对应。参数有四种形态：

```python
def fn(a, b, c=10, *args, **kwargs):
    pass

fn(1, 2)                 # 位置参数：按顺序对应 a、b
fn(b=2, a=1)             # 关键字参数：按名字对应
fn(1, 2, 3)              # c 有默认值，可省略
fn(1, 2, 3, 4, 5)        # *args 收多余的位置参数，成一个元组
fn(1, 2, x=9, y=8)       # **kwargs 收关键字参数，成一个字典
```

记忆口诀：**位置参数、关键字参数、默认值参数（缺省参数）、不定长参数（`*args` / `**kwargs`）**。

### 参数传递：可变对象与不可变对象

Python 里一切皆对象，所以严格来说既不是「值传递」也不是「引用传递」，而是**传对象的引用**——区别只在这个对象可不可改：

```python
def change(n):
    n = 10            # 不可变：只是重新绑定名字，外面不受影响

def add_item(items):
    items.append(4)   # 可变：原地修改，外面跟着变

a = 1
change(a)
print(a)              # 1，没变

lst = [1, 2, 3]
add_item(lst)
print(lst)            # [1, 2, 3, 4]，被改了
```

规律：不可变对象（`int`、`float`、`str`、`tuple`）传进去，函数里的「修改」只是重新绑定，影响不到外面；可变对象（`list`、`dict`、`set`）调用**原地修改的方法**（`append`、`pop`）会真的影响外面。想避免被影响，显式传副本。

### 默认参数的陷阱

默认值只在**函数定义时**求值一次，可变默认值会被后续所有调用共享：

```python
def add_item(item, target=[]):    # 危险：[] 只在定义时创建一次
    target.append(item)
    return target

add_item(1)   # [1]
add_item(2)   # [1, 2]  ← 不是你以为的 [2]
```

正确写法是用 `None` 占位，在函数体内再创建：

```python
def add_item(item, target=None):
    if target is None:
        target = []
    target.append(item)
    return target
```

### 强制位置参数 `/` 与 `*`

Python 3.8 起可用 `/` 和 `*` 在参数列表里划界，强制调用方式：

```python
def f(a, b, /, c, d, *, e, f):
    pass

f(10, 20, 30, d=40, e=50, f=60)      # 正确
f(10, b=20, c=30, d=40, e=50, f=60)  # 报错：/ 前的 a、b 只能按位置传
f(10, 20, 30, 40, 50, f=60)          # 报错：* 后的 e、f 只能按关键字传
```

`/` 前只能按位置传，`*` 后只能按关键字传，两者之间随意。

## 返回值

`return` 表示函数执行的结果，调用函数就等于拿到这个结果。Python 的函数天然支持多返回值：

```python
def fn():
    name = "user_a"
    age = 18
    return name, age      # 本质是返回一个元组

x, y = fn()               # 解包接收
```

一个常见误区：`print` 是「把结果打印到屏幕」，`return` 才是「把结果交给调用方」。前者给人看，后者给代码用。

## 作用域

变量在哪定义，就在哪个作用域里有效：

```python
total = 0                 # 全局变量

def add(n):
    # total += n          # 直接改全局变量会报错
    global total          # 声明要修改全局变量
    total += n

def show():
    x = 100               # 局部变量，函数外访问不到
    print(x)
```

规则很简单：**函数内部可以读全局变量，但改它要用 `global` 声明**；函数内部的局部变量，外部看不到。

## 匿名函数 lambda

`lambda` 是一个只有一行表达式的「一次性函数」，自带 return 效果：

```python
fn = lambda x, y: x + y   # 匿名函数写法
res = fn(1, 2)            # 3

def fn(x, y):             # 等价的命名函数写法
    return x + y
```

它常和 `sorted`、`map`、`filter` 这类需要「传一个函数进去」的场景搭配，追求的是简洁，而不是替代普通函数。

## 递归

递归就是「函数内部调用自身」，适合把大问题拆成结构相同的子问题。一个正确的递归有两个关键：**出口**（终止条件）和**递推**（向出口靠拢）。

```python
# 累加：1 + 2 + ... + n
def get_sum(n):
    if n == 1:            # 出口
        return 1
    return n + get_sum(n - 1)   # 递推

print(get_sum(10))        # 55
```

递归还能优雅地处理「嵌套结构」，比如统计一棵嵌套字典里总共有多少「叶子」：

```python
department = {
    "研发部": {"后端组": 3, "前端组": 11},
    "产品部": {"数据组": 3},
    "行政部": 1,
}

def count_people(d):
    total = 0
    for v in d.values():
        if isinstance(v, int):      # 叶子节点，直接累加
            total += v
        else:                        # 还是字典，递归深入
            total += count_people(v)
    return total

print(count_people(department))      # 18
```

注意递归要保证出口一定能走到，否则就成了「死递归」，和死循环一样停不下来。还有个硬限制：Python 默认递归深度上限是 1000 层（`sys.getrecursionlimit()` 查看），超了抛 `RecursionError`。要处理很深的嵌套结构，优先考虑改写成循环。

## 函数在大模型应用中的出场：工具调用

大模型应用里的「函数」有个新角色——**工具调用（Function Calling / Tool Use）**。你给模型声明「我有哪些函数可用」，模型决定要不要调用、用什么参数，然后你的代码去执行、把结果回填给模型：

```python
tools = [
    {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "查询某个城市的天气",
            "parameters": {
                "type": "object",
                "properties": {
                    "city": {"type": "string", "description": "城市名"}
                },
                "required": ["city"],
            },
        },
    }
]

response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "北京今天天气怎么样？"}],
    tools=tools,
)
```

模型会返回 `tool_calls`，告诉你它想调用 `get_weather`、参数是 `{"city": "北京"}`。你据此执行函数、把结果回填——这正是「函数 + 参数 + 返回值」知识在 AI 里的应用。更简洁的写法是用 Pydantic 定义参数结构，见《用 Pydantic 做结构化输出》一文。

## 小结

函数的本质是把「一段逻辑」变成「一个可调用的名字」。掌握四类参数、返回值与 `print` 的区别、作用域规则，就能写出可复用的代码；而 lambda 和递归，则是把函数这个工具用到更灵活的地方。下一篇讲 Python 的五大容器，那是函数之外另一块天天要打交道的核心。
