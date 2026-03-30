# OpenClaw Control Plane v1.0

## GET /tasks/summary

Returns active task counts grouped by state.

Terminal states excluded from the summary:
- `completed`
- `blocked`
- `archived`
- `failed`

If there are no active tasks, the endpoint returns:

```json
{
  "counts_by_state": {},
  "total_active": 0,
  "oldest_active_seconds": null
}
```

Example response:

```json
{
  "counts_by_state": {
    "builder_dispatched": 1,
    "review_pending": 2,
    "review_changes_requested": 1
  },
  "total_active": 4,
  "oldest_active_seconds": 3842
}
```
