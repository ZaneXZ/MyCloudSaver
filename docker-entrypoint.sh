#!/bin/sh

# 如果配置目录下没有 env 文件，则复制示例文件
if [ ! -f /app/config/env ]; then
    cp /app/.env.example /app/config/env
    echo "已创建默认配置文件 /app/config/env，请根据需要修改配置"
fi

# 创建配置文件软链接
ln -sf /app/config/env /app/.env

# 启动 Nginx 和后端服务
nginx -g 'daemon off;' & npm run start 