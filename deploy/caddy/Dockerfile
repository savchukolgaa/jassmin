# The production reverse proxy (#176): Caddy with the shop's Caddyfile built in, so the deploy only
# copies the Compose files to the server.
# The dashboard's password is hashed at start (entrypoint.sh, #183).
FROM caddy:2.10-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY no-data /etc/caddy/no-data
COPY --chmod=755 entrypoint.sh /usr/local/bin/entrypoint.sh
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD []
