# Deployment Guide - Hosting S3 Comms Uploader on AWS EC2

Hosting your Next.js application on an **AWS EC2** instance is an excellent upgrade compared to Vercel, particularly for media uploader systems.

---

## 🚀 Why EC2 is the Ultimate Host for Media Uploads

### 1. Unlimited Execution Time (No Serverless Timeouts)
- Vercel's serverless functions strictly timeout after **15 to 60 seconds**. If a team member uploads a large, high-res video, Vercel will terminate the function mid-compression.
- **On EC2**: There are **zero timeout constraints**. Next.js can run `ffmpeg` video encoding for minutes or hours without interruption.

### 2. Native, High-Speed Video Compression
- You can install native `ffmpeg` and `ffprobe` packages directly on your EC2 Linux instance. 
- **Adaptive video compression works 100% of the time** at maximum hardware performance speeds, reducing storage usage and bandwidth on S3.

### 3. Enterprise Security via IAM Roles (No Hardcoded Secret Keys)
- You **do not** need to store `AWS_ACCESS_KEY_ID` or `AWS_SECRET_ACCESS_KEY` in your `.env` configuration file on the server.
- Instead, you attach an **IAM Instance Profile (Role)** directly to your EC2 instance. The `@aws-sdk/client-s3` library automatically detects the role and securely signs uploads and deletions.

---

## 🛠️ Step-by-Step EC2 Production Setup

Assuming you are using an **Ubuntu Server (22.04 LTS or 24.04 LTS)** EC2 instance:

### Step 1: Attach an IAM Role to your EC2 Instance
1. Go to the **AWS IAM Console** and create a Role.
2. Select **AWS Service** > **EC2** as the trusted entity.
3. Attach a policy allowing access to your S3 bucket (replace `fdcp-images` with your bucket name):
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": [
           "s3:PutObject",
           "s3:PutObjectAcl",
           "s3:GetObject",
           "s3:DeleteObject"
         ],
         "Resource": "arn:aws:s3:::fdcp-images/*"
       }
     ]
   }
   ```
4. In the **EC2 Console**, right-click your instance > **Security** > **Modify IAM Role** and select your newly created Role.

---

### Step 2: Install System Dependencies (ffmpeg, Node.js)
SSH into your EC2 instance and run the following commands to install native compression utilities and Node.js:

```bash
# Update package lists
sudo apt update && sudo apt upgrade -y

# Install ffmpeg & ffprobe
sudo apt install ffmpeg -y

# Verify ffmpeg installation
ffmpeg -version
ffprobe -version

# Install Node.js (v20 LTS recommended)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verify Node installation
node -v
npm -v
```

---

### Step 3: Clone, Configure, and Build the Application
Clone your repository onto the EC2 instance and set up environment credentials:

```bash
# Clone the repository
git clone <your-repo-url> comms-uploader
cd comms-uploader

# Install project dependencies
npm install

# Create production environment config
nano .env.production
```

Inside `.env.production`, paste your Firebase client variables and S3 Bucket name. **Notice that you DO NOT need to paste AWS keys because EC2 will use the attached IAM Role!**

```env
# AWS Configuration (S3 Bucket & Region)
AWS_REGION=ap-southeast-1
AWS_S3_BUCKET=fdcp-images

# Firebase Client Credentials
NEXT_PUBLIC_FIREBASE_API_KEY=AIzaSyD5jsN2B...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=s3-uploader-2a975.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=s3-uploader-2a975
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=s3-uploader-2a975.firebasestorage.app
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=79916254774
NEXT_PUBLIC_FIREBASE_APP_ID=1:79916254774:web:2761d...
NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=G-5YRXJRMHVX
```

Save and exit (`Ctrl + O`, `Enter`, `Ctrl + X`).

```bash
# Build the production Next.js application
npm run build
```

---

### Step 4: Keep the Server Alive with PM2
PM2 is a production process manager for Node.js. It ensures your Next.js server runs permanently in the background and restarts automatically on instance reboots.

```bash
# Install PM2 globally
sudo npm install pm2 -g

# Start the Next.js application
pm2 start npm --name "comms-uploader" -- start

# Save PM2 process list and configure auto-start on boot
pm2 save
pm2 startup
```
*(Copy and paste the command output by `pm2 startup` to enable systemd boot integration).*

---

### Step 5: Configure Nginx as a Reverse Proxy
Nginx will listen on port `80` (HTTP) and `443` (HTTPS) and forward traffic to the Next.js server running on port `3000`.

```bash
# Install Nginx
sudo apt install nginx -y

# Configure virtual host configuration
sudo nano /etc/nginx/sites-available/comms-uploader
```

Paste the following configuration (replace `yourdomain.com` with your actual domain name or EC2 public IP):

```nginx
server {
    listen 80;
    server_name yourdomain.com;

    # Increase maximum request body size to allow large photo & video uploads
    client_max_body_size 100M;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Save and exit.

```bash
# Enable the site and restart Nginx
sudo ln -s /etc/nginx/sites-available/comms-uploader /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx
```

---

### Step 6: Enable HTTPS SSL (Let's Encrypt)
To secure uploads, encrypt user credentials, and enable secure clipboard copy features in Chrome/Safari:

```bash
# Install certbot
sudo apt install certbot python3-certbot-nginx -y

# Obtain and install SSL certificate automatically
sudo certbot --nginx -d yourdomain.com
```

Confirm all prompts to configure SSL and automatically redirect HTTP traffic to HTTPS. Your production EC2-powered S3 Comms Uploader is now ready for massive files and real-time history backtracking!
