# Traefik observations

Durable knowledge about Traefik, the reverse proxy of the Compose example
([`examples/compose.yaml`](../../examples/compose.yaml)). Each entry gives its
date, the method, the result and where its evidence is kept. These are
observations, not provider guarantees.

## Docker provider and container health

### Routing waits for a healthy container

- Date: 2026-11-11.
- Method: reading Traefik's Docker provider documentation (container health
  check behaviour) while specifying F-021 (#105); not measured on a running
  Traefik.
- Result: when a container has a health check, Traefik's Docker provider
  creates its route only while Docker reports the container `healthy`; a
  `starting` or `unhealthy` container gets no route, so requests for its host
  get a Traefik 404. With the image's 10 s interval, the service is
  unreachable for up to one interval after each (re)start
  ([F-021](../../features/F-021-container-health-check.md) D-7).
- Evidence: Traefik Docker provider documentation, cited by F-021 D-7 and its
  decision pass (#105); no measurement yet.
