# GitLab Docker 安装指南

## 目录
- [系统要求](#系统要求)
- [安装 Docker](#安装-docker)
- [安装 GitLab](#安装-gitlab)
- [配置 GitLab](#配置-gitlab)
- [常用命令](#常用命令)
- [常见问题](#常见问题)

---

## 系统要求

### 硬件要求
| 配置 | 最低要求 | 推荐配置 |
|------|----------|----------|
| CPU | 2 核 | 4 核+ |
| 内存 | 4 GB | 8 GB+ |
| 硬盘 | 40 GB | 100 GB+ |

### 软件要求
- **操作系统**: CentOS 7/8
- **Docker**: 20.10+
- **Docker Compose**: 2.0+

---

## 安装 Docker

### CentOS
```bash
# 安装 Docker
sudo yum install -y docker

# 启动 Docker
sudo systemctl start docker
sudo systemctl enable docker

# 验证安装
docker --version
```

### 配置国内镜像源（加速下载）
```bash
sudo mkdir -p /etc/docker
sudo tee /etc/docker/daemon.json <<-'EOF'
{
  "registry-mirrors": [
    "https://docker.mirrors.ustc.edu.cn",
    "https://hub-mirror.c.163.com"
  ]
}
EOF

sudo systemctl daemon-reload
sudo systemctl restart docker
```

---

## 安装 GitLab

### 1. 创建目录
```bash
sudo mkdir -p /srv/gitlab/{config,logs,data}
```

### 2. 创建配置文件
```bash
sudo nano /srv/gitlab/docker-compose.yml
```

写入以下内容：
```yaml
version: '3.6'
services:
  gitlab:
    image: gitlab/gitlab-ce:latest
    container_name: gitlab
    hostname: gitlab.example.com
    environment:
      GITLAB_OMNIBUS_CONFIG: |
        # 访问地址（改为你的服务器 IP 或域名）
        external_url 'http://你的服务器IP:8080'
        
        # 端口配置
        nginx['listen_port'] = 80
        
        # 可选：配置 SMTP 邮件
        # gitlab_rails['smtp_enable'] = true
        # gitlab_rails['smtp_address'] = "smtp.gmail.com"
        # gitlab_rails['smtp_port'] = 587
        # gitlab_rails['smtp_user_name'] = "your-email@gmail.com"
        # gitlab_rails['smtp_password'] = "your-password"
        # gitlab_rails['smtp_domain'] = "gmail.com"
        # gitlab_rails['smtp_authentication'] = "login"
        # gitlab_rails['smtp_enable_starttls_auto'] = true
    ports:
      - '8080:80'    # HTTP
      - '8443:443'   # HTTPS
      - '2222:22'    # SSH
    volumes:
      - '/srv/gitlab/config:/etc/gitlab'
      - '/srv/gitlab/logs:/var/log/gitlab'
      - '/srv/gitlab/data:/var/opt/gitlab'
    shm_size: '256m'
    restart: always
```

### 3. 启动 GitLab
```bash
cd /srv/gitlab
sudo docker-compose up -d
```

### 4. 查看启动状态
```bash
sudo docker logs -f gitlab
```

等待出现 `gitlab Reconfigured!` 表示启动完成（约2-5分钟）

### 5. 访问 GitLab
- 浏览器访问：`http://你的服务器IP:8080`
- 首次访问需要设置 root 密码
- 默认用户名：`root`

---

## 配置 GitLab

### 1. 设置 root 密码
首次访问 GitLab 时，会要求设置 root 密码（至少8位）

### 2. 创建用户
1. 以 root 登录 GitLab
2. 进入 **Admin Area** → **Users** → **New User**
3. 填写用户信息，设置密码
4. 创建后发送激活邮件或手动激活

### 3. 创建项目
1. 点击 **New Project**
2. 选择 **Create blank project**
3. 填写项目名称和路径
4. 设置可见性（Private/Internal/Public）
5. 点击 **Create project**

### 4. 配置 SSH Key
```bash
# 生成 SSH Key
ssh-keygen -t rsa -b 4096 -C "your-email@example.com"

# 查看公钥
cat ~/.ssh/id_rsa.pub
```

将公钥添加到 GitLab：
1. 进入 **Settings** → **SSH Keys**
2. 粘贴公钥
3. 点击 **Add key**

### 5. 创建 Personal Access Token
1. 进入 **Settings** → **Access Tokens**
2. 填写 Token 名称
3. 选择过期时间
4. 勾选 **api** 权限
5. 点击 **Create personal access token**
6. **重要：复制保存 Token，只显示一次**

### 6. 配置分支保护（可选）
1. 进入项目 **Settings** → **Repository**
2. 展开 **Protected branches**
3. 选择要保护的分支（如 main, develop）
4. 设置谁可以推送和合并

---

## 常用命令

### 服务管理
```bash
# 启动
cd /srv/gitlab
sudo docker-compose up -d

# 停止
sudo docker-compose down

# 重启
sudo docker-compose restart

# 查看状态
sudo docker-compose ps

# 查看日志
sudo docker logs -f gitlab
```

### 备份
```bash
# 创建备份
sudo docker exec gitlab gitlab-rake gitlab:backup:create

# 备份文件位置
ls /srv/gitlab/data/backups/
```

### 恢复
```bash
# 停止服务
sudo docker-compose down

# 恢复备份
sudo docker run --rm \
  -v /srv/gitlab/data:/var/opt/gitlab \
  -v /srv/gitlab/config:/etc/gitlab \
  gitlab/gitlab-ce:latest \
  gitlab-rake gitlab:backup:restore BACKUP=timestamp

# 启动服务
sudo docker-compose up -d
```

### 升级
```bash
# 停止服务
sudo docker-compose down

# 拉取新镜像
sudo docker pull gitlab/gitlab-ce:latest

# 启动服务
sudo docker-compose up -d
```

### 重置 root 密码
```bash
sudo docker exec -it gitlab gitlab-rake "gitlab:password:reset[root]"
```

---

## 常见问题

### 1. 启动失败
```bash
# 查看详细日志
sudo docker logs gitlab

# 常见原因：
# - 端口被占用
# - 内存不足
# - 配置文件错误
```

### 2. 端口冲突
如果 8080端口被占用，修改 `docker-compose.yml`：
```yaml
ports:
  - '9090:80'  # 改成其他端口
```

### 3. 内存不足
GitLab 至少需要 4GB 内存。如果内存不足：
```bash
# 添加 swap 分区
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# 永久生效
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### 4. 访问速度慢
配置国内镜像源加速镜像下载：
```bash
sudo mkdir -p /etc/docker
sudo tee /etc/docker/daemon.json <<-'EOF'
{
  "registry-mirrors": [
    "https://docker.mirrors.ustc.edu.cn",
    "https://hub-mirror.c.163.com"
  ]
}
EOF

sudo systemctl daemon-reload
sudo systemctl restart docker
```

### 5. 数据丢失
确保数据卷正确挂载：
```yaml
volumes:
  - '/srv/gitlab/config:/etc/gitlab'
  - '/srv/gitlab/logs:/var/log/gitlab'
  - '/srv/gitlab/data:/var/opt/gitlab'
```

### 6. 如何修改配置
```bash
# 进入容器
sudo docker exec -it gitlab bash

# 编辑配置
vi /etc/gitlab/gitlab.rb

# 重新配置
gitlab-ctl reconfigure

# 退出容器
exit
```

### 7. 查看 GitLab 版本
```bash
sudo docker exec gitlab cat /opt/gitlab/version-manifest.txt
```

### 8. 清理无用数据
```bash
# 清理 Docker 资源
docker system prune -a

# 清理 GitLab 无用数据
sudo docker exec gitlab gitlab-rake gitlab:cleanup:repos
```

---

## 配置 HTTPS（可选）

### 使用 Let's Encrypt
```yaml
environment:
  GITLAB_OMNIBUS_CONFIG: |
    external_url 'https://gitlab.example.com'
    letsencrypt['enable'] = true
    letsencrypt['contact_emails'] = ['your-email@example.com']
```

### 使用自定义证书
```yaml
environment:
  GITLAB_OMNIBUS_CONFIG: |
    external_url 'https://gitlab.example.com'
    nginx['ssl_certificate'] = "/etc/gitlab/ssl/server.crt"
    nginx['ssl_certificate_key'] = "/etc/gitlab/ssl/server.key"
volumes:
  - '/path/to/certs:/etc/gitlab/ssl'
```

---

## 更多资源

- [GitLab Docker 官方文档](https://docs.gitlab.com/ee/install/docker.html)
- [GitLab Docker Hub](https://hub.docker.com/r/gitlab/gitlab-ce)
- [GitLab 配置文档](https://docs.gitlab.com/omnibus/settings/)
