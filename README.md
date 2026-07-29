<p align="center">
<img src="./public/favicon.svg" width=20% height=20%>
</p>

Treelab is a Next.js application built for flexible, hierarchical data management. It allows users to create and organize data trees using custom-defined templates. The project draws inspiration from the excellent desktop application [Treeline](https://github.com/doug-101/TreeLine), while extending the concept to the web with browser-based access, collaborative tree sharing with concurrent editing, version control, and streamlined handling of images and file attachments within nodes.

In practice, Treelab is used daily to track laboratory activities, fabrication processes, present project progress to customers, and manage lightweight databases.

<p align="center">
    <img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/fda8a5ac-fa3e-47fd-a3b6-4882d6668384" />
</p>

##  Core Features

-   **🕸️ Hierarchical Data**: Organize data in a nested, tree-like structure with full drag-and-drop support for reordering and reparenting nodes.
-   **🎨 Custom Templates**: Design templates with a rich set of field types (text, date, dropdowns, pictures, tables, attachments, and more) to structure your data nodes.
-   **🌲 Multi-Tree Management**: Create, edit, rename, and switch between multiple independent data trees.
-   **🔄 Import/Export**: Export your trees and templates as JSON or ZIP archive for backup or sharing.
-   **🤝 Collaborative Sharing**: Tree can be shared with other users and concurrently edited.
-   **☁️ GitHub Sync**: Configure a GitHub Personal Access Token and link your trees to public or private repositories for document versioning and backup.

##   Disclaimer

This software was developed with the assistance of Large Language Models (AI). While every effort has been made to ensure the integrity, efficiency, and logic of the code through rigorous testing and security-focused reviews, users should be aware of the following:

-   Not for High-Risk Data: This application is not designed to store or process highly sensitive, classified, or "mission-critical" information (e.g., government secrets or financial infrastructure). While data is encrypted at rest, it is not a hardened vault.

-   Security Best Practices: For optimal security, Avoid exposing the application directly to the public internet unless needed and deploy this software locally or within a private network/VPN. Automated backup of database and binary data (attachments) is recommended.

-   As-Is Basis: This software is provided "as-is" without any express or implied warranties. The developer assumes no liability for data loss or security breaches resulting from misuse or unforeseen vulnerabilities.

## Attachment Security and Access

By design, access to uploaded attachments (pictures and files) via the `/attachments/` route is unauthenticated. This choice was made to facilitate seamless sharing of attachments and direct linking to assets without complex permission management for public pages.

To mitigate unauthorized access, the application uses **cryptographically unguessable filenames**. Brute-forcing or guessing a specific attachment URL is statistically impossible.

- **Generation Pattern**: `${ISO_TIMESTAMP}-${UUID_V4}-${ORIGINAL_FILENAME}`
    - `ISO_TIMESTAMP` (24 chars): Provides historical sequencing and millisecond precision.
    - `UUID_V4` (36 chars): Provides absolute randomness (122 bits of entropy).

An attacker would need to know the exact millisecond of upload AND correctly guess a 122-bit random string to discover a specific file. This results in approximately $5.3 \times 10^{36}$ (5.3 undecillion) possible combinations per millisecond. This level of collision resistance is considered absolute for any modern computing application.

While the URLs are unguessable, they effectively act as secret keys, anyone with the specific URL can access the file. If this is undesidered please consider not to expose Treelab publicly.

##   Getting Started & Configuration

The recommended setup is to use Docker with docker-compose, which will run Treelab together with a MongoDB container.

### docker-compose

Create a `docker-compose.yml` and a `.env` file (see below) in the same directory, then run `docker compose up -d`.

```yml
services:
    treelab:
        image: ghcr.io/asamarco/treelab
        container_name: treelab
        ports:
            - "3000:3000"
        volumes:
            - ./data:/app/data
        restart: unless-stopped
        env_file: .env
        depends_on:
            - mongo

    mongo:
        image: mongo:8.0
        container_name: mongodb
        restart: unless-stopped
        env_file: .env
        environment:
            - MONGO_INITDB_ROOT_USERNAME=${MONGODB_USER}
            - MONGO_INITDB_ROOT_PASSWORD=${MONGODB_PASSWORD}
        volumes:
            - mongo-data:/data/db

volumes:
    mongo-data:
```

> **Note:** The `data` folder (where attachments are stored) must be readable and writable by user `65532` (the default non-root user in distroless Docker images):
> ```sh
> chown -R 65532:65532 data/
> ```

### Environment Variables (`.env`)

Create a `.env` file alongside your `docker-compose.yml`. This file holds all secrets and runtime settings.

```sh
# ── Database Credentials & Connection ──────────────────────────────────────────
MONGODB_USER=admin          # MongoDB username (used by both the app and the mongo container on first init)
MONGODB_PASSWORD=secret     # MongoDB password (used by both the app and the mongo container on first init)
MONGODB_URI=mongodb://${MONGODB_USER}:${MONGODB_PASSWORD}@mongo:27017/treelab?authSource=admin

# ── Security & Encryption Keys ─────────────────────────────────────────────────
ENCRYPTION_KEY=ThisIsASecretKeyForEncryption123   # 32-char AES-256-GCM key — generate with: openssl rand -base64 24
JWT_SECRET_KEY=your_super_secret_jwt_key_at_least_32_chars  # JWT signing key (min. 32 chars)

# ── Authentication ─────────────────────────────────────────────────────────────
REQUIRE_AUTHENTICATION=true  # Set to false to disable login and run in single-user mode
USERID=test                  # Fallback user ID when REQUIRE_AUTHENTICATION=false
SECURE_COOKIE=true           # Set to false to allow auth over plain HTTP (no TLS)

# ── Session Duration ───────────────────────────────────────────────────────────
SESSION_EXPIRY_HOURS=12          # Session lifetime in hours for standard logins
SESSION_REMEMBER_ME_DAYS=30      # Session lifetime in days when "Remember Me" is checked

# ── REST API ───────────────────────────────────────────────────────────────────
ENABLE_API=false                    # Set to true to enable /api/v1 REST endpoints and PAT management UI
API_RATE_LIMIT_REQUESTS=120         # Max requests per user per time window
API_RATE_LIMIT_WINDOW_SECONDS=60    # Rate-limit reset window in seconds
```

#### Key variables explained

| Variable | Description |
|---|---|
| `MONGODB_USER` / `MONGODB_PASSWORD` | Credentials shared between the app and the MongoDB container's first-init setup. |
| `MONGODB_URI` | Full connection string. Uses the variables above when running with the provided compose file. |
| `ENCRYPTION_KEY` | 32-character key for AES-256-GCM encryption of sensitive data at rest. |
| `JWT_SECRET_KEY` | Secret used to sign and verify user session tokens (min. 32 characters). |
| `REQUIRE_AUTHENTICATION` | `true` enables multi-user login/registration (recommended for production). `false` runs the app in single-user demo mode using the `USERID` below. |
| `USERID` | Active user ID when `REQUIRE_AUTHENTICATION=false`. |
| `SECURE_COOKIE` | Set to `false` only if accessing the app over plain HTTP without TLS. |
| `ENABLE_API` | Set to `true` to expose the `/api/v1` REST API and Personal Access Token (PAT) management UI. |
