# 项目结构说明

本文档描述了实时语音转写应用的项目结构。

## 目录结构

```
RealtimeTranslation/
│
├── src/                    # 源代码目录
│   ├── app.py              # 主应用程序入口
│   ├── __init__.py         # Python 包初始化文件
│   │
│   ├── web/                # Web 相关文件
│   │   ├── __init__.py
│   │   ├── templates/      # Flask 模板
│   │   └── static/         # 静态资源（CSS、JS等）
│   │
│   ├── config/             # 配置文件
│   │   ├── __init__.py
│   │   └── .flaskenv       # Flask 环境变量
│   │
│   ├── services/           # 服务层
│   │   └── __init__.py
│   │
│   └── utils/              # 工具函数和模块
│       ├── __init__.py
│       ├── stt/            # 语音转文字功能
│       ├── tts/            # 文字转语音功能
│       └── llm/            # 大语言模型功能
│
├── tests/                  # 测试文件
│   ├── __init__.py
│   └── test_stt.py         # STT 功能测试
│
├── scripts/                # 脚本文件
│   └── start_app.bat       # 应用启动脚本
│
├── logs/                   # 日志文件
│   └── app.log             # 应用运行日志
│
├── docs/                   # 文档
│   └── project_structure.md # 本文档
│
└── requirements.txt        # 依赖包列表
```

## 主要组件说明

### 1. 语音转文字 (STT)

位于 `src/utils/stt/` 目录，负责处理音频输入并转换为文本。主要使用 Whisper 模型进行实时语音识别。

### 2. 文字转语音 (TTS)

位于 `src/utils/tts/` 目录，负责将文本转换为语音输出。

### 3. 大语言模型 (LLM)

位于 `src/utils/llm/` 目录，负责处理自然语言理解和翻译功能。

### 4. Web 界面

位于 `src/web/` 目录，包括 Flask 模板和静态资源，提供用户界面。

## 如何运行

使用脚本启动应用程序：

```
cd RealtimeTranslation
scripts\start_app.bat
```

或者直接运行 Python 模块：

```
cd RealtimeTranslation
python -m src.app
```

## 开发指南

1. 请确保在修改代码前激活合适的虚拟环境
2. 安装所有依赖: `pip install -r requirements.txt`
3. 所有新功能应当先添加测试，然后再实现 