FROM apify/actor-node:20
COPY --chown=myuser:myuser package.json ./
RUN npm --quiet set progress=false && npm install --omit=dev
COPY --chown=myuser:myuser . ./
CMD npm run start:prod --silent
