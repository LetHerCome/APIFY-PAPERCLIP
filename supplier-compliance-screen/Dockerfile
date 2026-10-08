FROM apify/actor-node:20

COPY --chown=myuser:myuser package*.json ./
RUN npm --quiet --omit=dev install

COPY --chown=myuser:myuser . ./
CMD npm start --silent
