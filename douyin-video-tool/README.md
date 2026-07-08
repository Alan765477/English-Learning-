# 抖音视频自动生产工具

一条命令,把一个**想法**变成一条**可直接发布的抖音竖屏视频**:

```
你输入想法 → DeepSeek 写标题/文案/标签/分镜口播
           → 自动从 Pexels 下载匹配的高清素材(1080p+,优先 60fps,免费商用)
           → Edge TTS 自动配音(免费)
           → ffmpeg 自动剪辑:竖屏裁剪 + 烧录字幕 + 拼接混音
           → 输出 成品.mp4 + 文案.txt(标题/文案/标签,直接复制粘贴)
```

最后一步(上传发布)留给你人工完成——抖音没有对个人开放发布 API,人工点发布既安全(不违反平台规则、不担心封号),也能在发出前把关质量。

## 一、首次安装(只需一次)

需要 Python 3.10 以上(<https://www.python.org/downloads/> 安装时勾选 "Add to PATH")。

```bash
cd douyin-video-tool
pip install -r requirements.txt
```

不需要单独安装 ffmpeg,依赖包里自带。

## 二、填入 API key(只需一次)

把 `config.example.json` 复制一份改名为 `config.json`,填入两个 key:

```json
{
  "deepseek_api_key": "sk-你的DeepSeek密钥",
  "pexels_api_key": "你的Pexels密钥"
}
```

- DeepSeek key:<https://platform.deepseek.com>(充 10 元能用很久)
- Pexels key:<https://www.pexels.com/api/>(免费)

`config.json` 已被 .gitignore 忽略,**不会**被提交到 GitHub。请勿把 key 发给任何人。

## 三、生成视频

```bash
python make_video.py "3个让英语口语翻倍的小技巧"
```

几分钟后在 `output/日期_标题/` 目录得到:

| 文件 | 说明 |
|---|---|
| `成品.mp4` | 1080x1920 竖屏、60fps、带配音和字幕,可直接上传 |
| `文案.txt` | 标题、文案、标签,整段复制即可 |
| `素材来源.txt` | 每个分镜用的 Pexels 素材链接(留档备查) |

### 常用参数

```bash
python make_video.py "想法" --scenes 4     # 改分镜数(默认5个,视频越长分镜越多)
python make_video.py "想法" --no-tts       # 不要AI配音,只烧字幕(自己后期配音时用)
python make_video.py "想法" --keep-temp    # 保留下载的原始素材和单段分镜
python make_video.py --demo               # 不消耗任何API额度,测试环境是否正常
```

### 发布

打开抖音创作者中心 <https://creator.douyin.com/> → 发布视频 → 上传 `成品.mp4` → 粘贴 `文案.txt` 内容 → 选封面、位置 → 立即发布或**定时发布**(可以一次做好一批,排期发)。

## 四、自定义(config.json)

| 配置项 | 默认 | 说明 |
|---|---|---|
| `video.scenes` | 5 | 每条视频的分镜数 |
| `video.fps` | 60 | 成片帧率 |
| `video.min_scene_seconds` | 3.0 | 单个分镜最短时长(秒) |
| `tts.voice` | zh-CN-XiaoxiaoNeural | 配音音色,男声可换 `zh-CN-YunxiNeural` |
| `tts.rate` | +10% | 语速,如 `+20%` 更快 |
| `subtitle.font_size` | 62 | 字幕字号 |
| `subtitle.font_file` | 自动探测 | 字幕字体文件,如 `C:\\Windows\\Fonts\\msyh.ttc` |
| `llm.model` | deepseek-chat | 换模型/换兼容 OpenAI 接口的服务商都在 `llm` 里改 |

查看全部可用配音音色:`edge-tts --list-voices | grep zh-CN`

## 常见问题

**配音失败/超时?** Edge TTS 需要能访问微软服务器,偶尔抽风重跑一次即可;实在不行加 `--no-tts` 出无配音版本。

**字幕显示方块?** 没找到中文字体。在 `config.json` 里把 `subtitle.font_file` 指到一个中文字体文件(Windows: `C:\\Windows\\Fonts\\msyh.ttc`)。

**素材不贴合内容?** Pexels 是实拍素材库,抽象概念(如"语法")搜不到对应画面。想法越具体、越有画面感,选出的素材越贴合;也可以用 `--keep-temp` 看原始素材,不满意就重跑。

**能不能全自动发布?** 抖音的视频发布 API 只对企业号开放;用脚本模拟网页操作违反平台规则、有封号风险,所以本工具止步于"发布前一切就绪"。抖音创作者中心自带定时发布,足够实现批量排期。

**版权安全吗?** 素材全部来自 Pexels,其许可允许免费商用、修改、无需署名;每条视频的素材来源都记录在 `素材来源.txt`。
