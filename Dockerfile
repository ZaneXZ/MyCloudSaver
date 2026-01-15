# 构建前端项目
FROM node:18-alpine as frontend-build
WORKDIR /app
COPY frontend/package*.json ./
RUN npm install -g pnpm
RUN pnpm install
COPY frontend/ ./
RUN npm run build

# 构建后端项目
FROM node:18-alpine as backend-build
WORKDIR /app
COPY backend/package*.json ./
RUN npm install -g pnpm
RUN pnpm install
COPY backend/ ./
RUN rm -f database.sqlite
RUN npm run build

# 生产环境镜像
FROM node:18-alpine

# 安装 Nginx
RUN apk add --no-cache nginx

# 设置工作目录
WORKDIR /app

# 创建配置和数据目录
RUN mkdir -p /app/config /app/data

# 复制前端构建产物到 Nginx
COPY --from=frontend-build /app/dist /usr/share/nginx/html

# 复制 Nginx 配置文件
COPY nginx.conf /etc/nginx/nginx.conf

# 复制后端构建产物到生产环境镜像
COPY --from=backend-build /app /app

# 安装生产环境依赖
RUN npm install --production

# 设置数据卷
VOLUME ["/app/config", "/app/data"]

# 暴露端口
EXPOSE 8008

# 启动脚本
COPY docker-entrypoint.sh /app/
RUN chmod +x /app/docker-entrypoint.sh

# 启动服务
ENTRYPOINT ["/app/docker-entrypoint.sh"]
