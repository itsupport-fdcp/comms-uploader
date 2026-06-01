# FDCP Comms S3 Uploader

An internal media upload and history tracking system built for the **Film Development Council of the Philippines (FDCP)** Communications team. Built with Next.js 16, AWS S3, and a local SQLite database.

---

## Features

- **Firebase Auth** — Secure sign-in and sign-up for internal team members
- **AWS S3 Upload** — Direct file upload to S3 with presigned URLs
- **Automatic Image Compression** — Client-side conversion to WebP (targeting under 1 MB)
- **Automatic Video Compression** — Server-side FFmpeg compression with adaptive bitrate and resolution scaling
- **Upload History** — Persistent upload log stored in a local SQLite database
- **Version Tracking** — Every upload and re-upload is versioned with full backtracking support
- **Audit Log** — All actions (UPLOAD, REUPLOAD, DELETE, RESTORE_VERSION) are recorded
- **Event-based Organization** — Files are associated with FDCP events (PFIM, Filmart, CinePanalo, etc.)
- **Search & Filtering** — Filter history by filename, file type, uploader, and date range
- **Bulk Copy Links** — Copy all S3 URLs as a newline column or CSV in one click

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) |
| Styling | Tailwind CSS v4 |
| Auth | Firebase Authentication |
| File Storage | Amazon S3 |
| Database | SQLite via `sql.js` |
| Video Processing | FFmpeg (server-side) |
| Icons | Lucide React |

---

## Project Structure

```
src/
├── app/
│   ├── api/
│   │   ├── upload/
│   │   │   ├── route.ts              # POST - Upload file to S3 + write to SQLite
│   │   │   └── [id]/
│   │   │       ├── versions/route.ts # GET  - Fetch version history
│   │   │       └── restore/route.ts  # POST - Restore a previous version
│   │   ├── delete/route.ts           # POST - Delete from S3 + remove SQLite record
│   │   ├── history/route.ts          # GET  - Fetch upload history
│   │   └── events/route.ts           # GET  - Fetch FDCP events list
│   ├── page.tsx                      # Main dashboard UI
│   ├── layout.tsx
│   └── globals.css
├── lib/
│   └── db.ts                         # SQLite initialization and schema
└── firebase.ts                       # Firebase client config
data/
└── comms_uploader.db                 # SQLite database (auto-created on first run)
```

---

## Database Schema

The SQLite database (`data/comms_uploader.db`) contains four tables:

- **`events`** — FDCP campaigns (PFIM, Filmart, CinePanalo, etc.)
- **`uploads`** — Current file records with S3 key, URL, sizes, and uploader
- **`upload_versions`** — Full version history for each upload (supports backtracking)
- **`upload_actions`** — Audit log of every action performed on each file

---

## Getting Started

### Prerequisites

- Node.js 18+
- FFmpeg installed and available in PATH (for video compression)
- AWS S3 bucket with appropriate permissions
- Firebase project with Authentication enabled

### Environment Variables

Create a `.env.local` file in the project root:

```env
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
AWS_REGION=ap-southeast-1
AWS_S3_BUCKET=your-bucket-name

NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=...
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...
```

### Run Locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

The SQLite database is created automatically at `data/comms_uploader.db` on first run and seeded with the default FDCP events.

---

## API Endpoints

| Method | Route | Description |
|---|---|---|
| `GET` | `/api/events` | Returns all events |
| `GET` | `/api/history` | Returns upload history (supports filters) |
| `POST` | `/api/upload` | Uploads a file and records to SQLite |
| `POST` | `/api/delete` | Deletes from S3 and removes SQLite record |
| `GET` | `/api/upload/[id]/versions` | Returns version history for a file |
| `POST` | `/api/upload/[id]/restore` | Restores a previous version |

---

## Deployment

See [`ec2_deployment_guide.md`](./ec2_deployment_guide.md) for full EC2 deployment instructions.
