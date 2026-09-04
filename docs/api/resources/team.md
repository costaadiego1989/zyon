# Team

Manage team members, roles, and access to your merchant account.

## Endpoints

### GET /v1/team/members

List all team members for the merchant.

**Auth:** `team:read`

**Response:**
```json
{
  "data": [
    {
      "user_id": "usr_123",
      "email": "owner@example.com",
      "name": "Account Owner",
      "role": "owner",
      "status": "active",
      "joined_at": "2024-01-01T10:30:00Z"
    },
    {
      "user_id": "usr_456",
      "email": "admin@example.com",
      "name": "Admin User",
      "role": "admin",
      "status": "active",
      "joined_at": "2024-06-01T10:30:00Z"
    }
  ],
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:30:00Z",
    "version": "v1"
  }
}
```

### POST /v1/team/invitations

Invite a new team member to the merchant account.

**Auth:** `team:write`

**Request:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| email | string | Yes | Email address to invite |
| role | string | Yes | Role (owner, admin, staff) |

**Response:**
```json
{
  "data": {
    "invitation_id": "inv_abc",
    "email": "newmember@example.com",
    "role": "admin",
    "status": "pending",
    "invited_at": "2024-08-18T10:30:00Z",
    "expires_at": "2024-08-25T10:30:00Z",
    "accept_url": "https://app.aacp.dev/invitations/inv_abc/accept?token=abc123"
  },
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:30:00Z",
    "version": "v1"
  }
}
```

**cURL Example:**
```bash
curl -X POST https://api.aacp.dev/v1/team/invitations \
  -H "Authorization: Bearer aacp_test_..." \
  -H "Content-Type: application/json" \
  -d '{
    "email": "newmember@example.com",
    "role": "admin"
  }'
```

### POST /v1/team/invitations/:id/accept

Accept a team invitation (human-only).

**Auth:** Not required (invitation token validates access)

**Request:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| token | string | Yes | Invitation acceptance token |

**Response:**
```json
{
  "data": {
    "user_id": "usr_new",
    "email": "newmember@example.com",
    "role": "admin",
    "status": "active",
    "joined_at": "2024-08-18T10:30:00Z"
  },
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:30:00Z",
    "version": "v1"
  }
}
```

### PATCH /v1/team/members/:id/role

Update a team member's role (owner/admin can change staff/admin roles only).

**Auth:** `team:write`

**Request:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| role | string | Yes | New role (admin, staff) |

**Response:**
```json
{
  "data": {
    "user_id": "usr_456",
    "email": "admin@example.com",
    "role": "staff",
    "updated_at": "2024-08-18T10:35:00Z"
  },
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:35:00Z",
    "version": "v1"
  }
}
```

### DELETE /v1/team/members/:id

Remove a team member from the merchant account.

**Auth:** `team:write`

**Request:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| id | string (path) | Yes | User ID to remove |

**Response:**
```json
{
  "data": {
    "user_id": "usr_456",
    "removed_at": "2024-08-18T10:30:00Z"
  },
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:30:00Z",
    "version": "v1"
  }
}
```
