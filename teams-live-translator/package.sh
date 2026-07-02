#!/bin/sh
# Build the Teams app package (a zip with manifest.json + the two icons at the
# zip ROOT — Teams rejects packages where they sit inside a folder).
cd "$(dirname "$0")" || exit 1
rm -f teams-app.zip
zip -j teams-app.zip manifest.json color.png outline.png
echo "生成完毕：teams-app.zip —— 在 Teams 里「应用 → 管理你的应用 → 上传自定义应用」选这个文件"
