FROM ghcr.io/puppeteer/puppeteer:23.10.3

# Switch to root to fix directory ownership
USER root
WORKDIR /usr/src/app

# Fix directory permissions for the pptruser account
RUN chown -R pptruser:pptruser /usr/src/app

# Switch back to pptruser for security
USER pptruser

COPY --chown=pptruser:pptruser package*.json ./
RUN npm ci

COPY --chown=pptruser:pptruser . .

EXPOSE 3000
CMD ["node", "server.js"]
