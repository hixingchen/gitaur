# Docker 完整教程

## 目录
- [Docker 简介](#docker-简介)
- [安装 Docker](#安装-docker)
- [Docker 基础命令](#docker-基础命令)
- [Docker Compose](#docker-compose)
- [常用操作](#常用操作)
- [常见问题](#常见问题)

---

## Docker 简介

### 什么是 Docker
Docker 是一个开源的应用容器引擎，让开发者可以打包应用及其依赖包到一个可移植的容器中，然后发布到任何流行的 Linux 机器上。

### Docker 的优势
- **轻量级**：容器共享主机内核，启动速度快
- **隔离性**：每个容器独立运行，互不影响
- **可移植**：一次构建，到处运行
- **版本控制**：可以快速回滚到之前的版本

### 核心概念
| 概念 | 说明 |
|------|------|
| 镜像 (Image) | 只读模板，包含运行应用所需的一切 |
| 容器 (Container) | 镜像的运行实例 |
| 仓库 (Registry) | 存储镜像的地方（如 Docker Hub） |
| Dockerfile | 构建镜像的配置文件 |
| docker-compose | 多容器编排工具 |

---

## 安装 Docker

### CentOS
```bash
# 安装依赖
sudo yum install -y yum-utils

# 添加 Docker 仓库
sudo yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo

# 安装 Docker
sudo yum install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# 启动 Docker
sudo systemctl start docker
sudo systemctl enable docker

# 验证安装
docker --version
docker-compose --version
```

### 配置国内镜像源（加速下载）
```bash
sudo mkdir -p /etc/docker
sudo tee /etc/docker/daemon.json <<-'EOF'
{
  "registry-mirrors": [
    "https://docker.mirrors.ustc.edu.cn",
    "https://hub-mirror.c.163.com",
    "https://mirror.ccs.tencentyun.com"
  ]
}
EOF

sudo systemctl daemon-reload
sudo systemctl restart docker
```

---

## Docker 基础命令

### 镜像操作
```bash
# 搜索镜像
docker search 镜像名

# 拉取镜像
docker pull 镜像名:版本

# 查看本地镜像
docker images

# 删除镜像
docker rmi 镜像名:版本

# 删除所有未使用的镜像
docker image prune -a
```

### 容器操作
```bash
# 创建并启动容器
docker run [选项] 镜像名

# 常用选项：
# -d: 后台运行
# -it: 交互式运行
# --name: 容器名称
# -p: 端口映射（主机端口:容器端口）
# -v: 数据卷挂载（主机目录:容器目录）
# -e: 设置环境变量
# --restart: 重启策略（always/unless-stopped/on-failure）

# 查看运行中的容器
docker ps

# 查看所有容器（包括已停止）
docker ps -a

# 启动/停止/重启容器
docker start 容器名
docker stop 容器名
docker restart 容器名

# 进入容器
docker exec -it 容器名 /bin/bash

# 查看容器日志
docker logs 容器名
docker logs -f 容器名  # 实时查看

# 删除容器
docker rm 容器名

# 强制删除运行中的容器
docker rm -f 容器名

# 删除所有已停止的容器
docker container prune
```

### 数据卷操作
```bash
# 创建数据卷
docker volume create 卷名

# 查看数据卷
docker volume ls

# 删除数据卷
docker volume rm 卷名

# 删除所有未使用的数据卷
docker volume prune
```

---

## Docker Compose

### 什么是 Docker Compose
Docker Compose 是一个用于定义和运行多容器 Docker 应用的工具。通过一个 `docker-compose.yml` 配置文件来管理多个容器。

### 安装 Docker Compose
```bash
# 方式1：使用插件（推荐）
sudo apt-get install docker-compose-plugin

# 方式2：独立安装
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
```

### docker-compose.yml 基本结构
```yaml
version: '3.8'  # Compose 文件版本

services:        # 服务定义
  服务名:
    image: 镜像名:版本        # 使用的镜像
    container_name: 容器名    # 容器名称
    ports:                    # 端口映射
      - '主机端口:容器端口'
    volumes:                  # 数据卷挂载
      - '主机路径:容器路径'
    environment:              # 环境变量
      - KEY=value
    restart: always           # 重启策略
    depends_on:               # 依赖服务
      - 其他服务名

  另一个服务:
    image: 镜像名:版本
    ...
```

### 常用命令
```bash
# 启动所有服务（后台运行）
docker-compose up -d

# 停止所有服务
docker-compose down

# 停止并删除容器、网络、数据卷
docker-compose down -v

# 查看服务状态
docker-compose ps

# 查看服务日志
docker-compose logs
docker-compose logs -f 服务名

# 重启服务
docker-compose restart 服务名

# 进入容器
docker-compose exec 服务名 /bin/bash

# 构建镜像
docker-compose build

# 重新创建容器（配置变更后）
docker-compose up -d --force-recreate
```

### 完整示例：Web 应用 + 数据库
```yaml
version: '3.8'

services:
  web:
    image: nginx:latest
    container_name: web
    ports:
      - '80:80'
    volumes:
      - './html:/usr/share/nginx/html'
    depends_on:
      - db
    restart: always

  db:
    image: mysql:8.0
    container_name: db
    environment:
      MYSQL_ROOT_PASSWORD: root123
      MYSQL_DATABASE: myapp
    volumes:
      - 'db_data:/var/lib/mysql'
    restart: always

volumes:
  db_data:
```

---

## 常用操作

### 查看容器资源使用
```bash
docker stats
```

### 查看容器详细信息
```bash
docker inspect 容器名
```

### 复制文件
```bash
# 从容器复制到主机
docker cp 容器名:/path/to/file /host/path

# 从主机复制到容器
docker cp /host/path 容器名:/path/to/file
```

### 备份和恢复
```bash
# 备份容器为镜像
docker commit 容器名 镜像名:版本

# 导出镜像为文件
docker save -o 镜像名.tar 镜像名:版本

# 从文件导入镜像
docker load -i 镜像名.tar
```

### 清理资源
```bash
# 清理所有未使用的资源（镜像、容器、网络、数据卷）
docker system prune -a

# 只清理未使用的镜像
docker image prune -a

# 只清理未使用的容器
docker container prune

# 只清理未使用的数据卷
docker volume prune
```

---

## 常见问题

### 1. 权限问题
```bash
# 将当前用户添加到 docker 组
sudo usermod -aG docker $USER
# 重新登录生效
```

### 2. 容器无法启动
```bash
# 查看详细日志
docker logs 容器名

# 检查容器状态
docker inspect 容器名
```

### 3. 端口被占用
```bash
# 查看端口占用
sudo netstat -tlnp | grep 端口号
# 或
sudo lsof -i :端口号
```

### 4. 磁盘空间不足
```bash
# 清理未使用的资源
docker system prune -a

# 查看 Docker 磁盘使用
docker system df
```

### 5. 网络问题
```bash
# 查看网络
docker network ls

# 创建网络
docker network create 网络名

# 查看网络详情
docker network inspect 网络名
```

### 6. 容器内无法访问外部网络
```bash
# 检查 DNS 配置
docker exec 容器名 cat /etc/resolv.conf

# 重启 Docker
sudo systemctl restart docker
```

---

## 更多资源

- [Docker 官方文档](https://docs.docker.com/)
- [Docker Hub](https://hub.docker.com/)
- [Docker Compose 文档](https://docs.docker.com/compose/)
