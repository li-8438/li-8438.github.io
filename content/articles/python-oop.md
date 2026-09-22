---
title: Python 面向对象：类、对象与三大特性
slug: python-oop
summary: 用类做模板、对象做实体，搞懂 self 和魔法方法，再吃透封装、继承、多态三大特性。
tags: [Python, 面向对象, 进阶]
section: 学习笔记
topic: Python
subtopic: ""
published: true
---

前面写的都是「过程式」代码——数据归数据，函数归函数。面向对象（OOP）换了一种组织方式：**把数据和操作它的方法打包在一起**，做成一个个有名字的「对象」。代码规模一大，这种方式更贴近人对世界的直觉。

## 类与对象

类是模板，对象是用模板造出来的实体。关系就像「设计图纸」和「按图纸造出来的车」：

```python
class Car:
    def __init__(self, num):
        self.num = num          # 属性：以前写的「变量」

    def show_wheels(self):      # 方法：以前写的「函数」
        print(f"轮子数量是 {self.num}")

bmw = Car(4)        # 用类创建对象
bmw.show_wheels()   # 调用对象的方法
```

类外部用「对象.属性」访问，类内部用「self.属性」访问。

## self 是什么

`self` 不是关键字，只是个约定俗成的名字。它的含义一句话：**谁调用的，self 就是谁**。在 `__init__` 里，self 指的就是正在创建的这个实例对象。所以每个对象通过 self 绑定的属性都是各自独立的，互不干扰。

## 魔法方法

魔法方法是在特定时刻会被**自动调用**的方法，名字前后各有两个下划线。最常用的三个：

```python
class Car:
    def __init__(self, num):      # 创建对象时自动调用
        self.num = num

    def __str__(self):            # print(对象) / str(对象) 时自动调用
        return f"这辆车有 {self.num} 个轮子"

    def __del__(self):            # 删除对象时自动调用
        print("对象被回收了")

car = Car(4)
print(car)    # 触发 __str__
```

## 用 __init__ 定制对象

如果不写 `__init__`，每个对象都要手动一条条加属性，既啰嗦又容易漏。`__init__` 让你在创建时就把差异传进去：

```python
class Car:
    def __init__(self, num):
        self.num = num

sedan = Car(4)      # 小轿车 4 个轮子
truck = Car(8)      # 卡车 8 个轮子
trailer = Car(16)   # 挂车 16 个轮子
```

同一个类，不同参数，造出不同对象——这就是「模板复用」。

## 三大特性

### 封装

把属性和方法写进类里，并支持私有化——名字前加两个下划线，外部就无法直接访问：

```python
class Account:
    def __init__(self, balance):
        self.__balance = balance   # 私有属性

    def get_balance(self):
        return self.__balance      # 只能通过方法访问
```

### 继承

子类继承父类的属性和方法，从近到远逐层查找，找到了就跳过。可以用 `.mro()` 查看继承顺序，私有属性和方法不能被继承：

```python
class Person:
    def __init__(self, name):
        self.name = name

    def work(self):
        print("上班")

class Programmer(Person):    # 继承 Person
    def work(self):          # 重写父类方法
        print(f"{self.name} 在写代码")

p = Programmer("user_a")
p.work()      # user_a 在写代码
```

### 多态

Python 是弱类型语言，没有严格意义上的多态。它的表现是：**不同对象调用相同的方法名，各干各的事**，鸭子类型让多态天然成立：

```python
def start_work(obj):
    obj.work()

start_work(Person("user_b"))          # 上班
start_work(Programmer("user_c"))    # user_c 在写代码
```

## 一个完整的 ATM 案例

把查询、存钱、取钱封装进一个类：

```python
class ATM:
    def __init__(self, bank, account, password):
        self.bank = bank
        self.account = account
        self.password = password
        self.money = 0

    def search(self):
        print(f"当前余额：{self.money}")

    def save(self):
        self.money += int(input("存入金额："))

    def withdraw(self):
        self.money -= int(input("取出金额："))

    def start(self):
        while True:
            op = input("1 查询 2 存钱 3 取钱 4 退出：")
            if op == "1":
                self.search()
            elif op == "2":
                self.save()
            elif op == "3":
                self.withdraw()
            elif op == "4":
                break

card = ATM("示例银行", "user1", "123456")
card.start()
```

## 小结

面向对象的核心是一句话：**类是模板，对象是实体，self 指当前对象**。三大特性里，封装管「数据安全」，继承管「代码复用」，多态管「灵活扩展」。下一篇讲 super 关键字，以及闭包和装饰器——那是把「函数」这个工具玩出花的进阶内容。
