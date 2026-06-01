# SQLite Local History & Event-Based Backtracking Implementation Guide

## Overview

This implementation replaces Firestore with a lightweight local SQLite database while introducing event-based organization, upload versioning, and audit logging.

The goal is to provide:

* Zero external database dependencies
* Low-cost EC2 deployment
* Event-based file organization
* Upload history and audit trail
* Future-proof backtracking and version restoration

---

# System Architecture

## Storage Layer

### Amazon S3

S3 remains the primary file storage system.

Recommended structure:

communications/
└── 2026/
├── PFIM-2026/
│   ├── photos/
│   └── videos/
├── Filmart-2026/
│   ├── photos/
│   └── videos/
└── CinePanalo-2026/
├── photos/
└── videos/

### SQLite Database

SQLite serves as the metadata and history repository.

Recommended database location:

/data/comms_uploader.db

This avoids accidental deletion during deployments and simplifies backups.

---

# Database Schema

## events

Stores FDCP events and campaigns.

CREATE TABLE events (
id INTEGER PRIMARY KEY AUTOINCREMENT,
name TEXT NOT NULL,
year INTEGER NOT NULL,
created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

Example:

PFIM 2026
Filmart 2026
CinePanalo 2026

---

## uploads

Stores the current file record.

CREATE TABLE uploads (
id INTEGER PRIMARY KEY AUTOINCREMENT,
event_id INTEGER NOT NULL,
filename TEXT NOT NULL,
s3_key TEXT NOT NULL,
url TEXT NOT NULL,
file_type TEXT,
original_size INTEGER,
compressed_size INTEGER,
uploaded_by TEXT,
uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
current_version INTEGER DEFAULT 1,
FOREIGN KEY(event_id) REFERENCES events(id)
);

---

## upload_versions

Stores all historical versions.

CREATE TABLE upload_versions (
id INTEGER PRIMARY KEY AUTOINCREMENT,
upload_id INTEGER NOT NULL,
version_number INTEGER NOT NULL,
filename TEXT,
s3_key TEXT,
url TEXT,
uploaded_by TEXT,
uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
FOREIGN KEY(upload_id) REFERENCES uploads(id)
);

This enables true backtracking and restoration.

Example:

Poster.jpg

Version 1
Version 2
Version 3

Older versions remain accessible.

---

## upload_actions

Stores audit logs.

CREATE TABLE upload_actions (
id INTEGER PRIMARY KEY AUTOINCREMENT,
upload_id INTEGER,
action TEXT,
performed_by TEXT,
created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

Supported actions:

UPLOAD
REUPLOAD
DELETE
COPY_LINK
RESTORE_VERSION

---

# Upload Workflow

1. User selects an event.
2. File is compressed.
3. File uploads to S3.
4. File metadata is stored in uploads.
5. Initial version is stored in upload_versions.
6. Audit log is written.

Result:

S3 and SQLite remain synchronized.

---

# Re-upload Workflow

Instead of overwriting records:

DO NOT:

UPDATE uploads SET url = ? WHERE id = ?

Instead:

1. Upload new file to S3.
2. Create a new row in upload_versions.
3. Increment current_version.
4. Update uploads to point to the latest version.
5. Write REUPLOAD audit log.

Benefits:

* Full history preserved
* Previous files recoverable
* Better accountability

---

# Delete Workflow

1. Delete file from S3.
2. Delete record from uploads.
3. Optionally retain version history.
4. Create DELETE audit log.

---

# API Endpoints

GET /api/events

Returns all events.

GET /api/history

Returns upload history.

POST /api/upload

Uploads files and creates records.

POST /api/reupload

Creates a new upload version.

DELETE /api/delete

Deletes file and metadata.

GET /api/upload/[id]/versions

Returns complete version history.

POST /api/upload/[id]/restore

Restores a previous version.

---

# Frontend Structure

Dashboard

* Total uploads
* Storage usage
* Recent activity

Events

* PFIM 2026
* Filmart 2026
* CinePanalo 2026

Upload

* Select event
* Upload files

History

* Search
* Filter
* Sort

File Details

* Metadata
* Version history
* Audit trail

---

# Search & Filtering

Client-side filtering remains available through React useMemo.

Filters:

* Event
* Date
* File type
* Uploader
* Filename

Expected performance remains near-instant for thousands of records.

---

# Advantages Over Firebase

* No external database service
* Lower hosting costs
* Smaller bundle size
* Simpler deployment
* Easier backups
* Better event organization
* Full version history support
* Local ownership of metadata

---

# Future Enhancements

Phase 2:

* User authentication
* Event permissions
* CloudFront integration
* Scheduled database backups
* Export history to CSV
* Restore deleted versions
* Storage analytics

This architecture is designed for FDCP communications operations where multiple events are conducted annually and historical media assets must remain searchable, traceable, and recoverable.
