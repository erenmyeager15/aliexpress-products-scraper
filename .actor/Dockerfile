FROM apify/actor-node-playwright-chrome:20

COPY --chown=myuser package*.json ./
RUN npm ci --include=dev

COPY --chown=myuser . ./
RUN npm run build

CMD ./start_xvfb_and_run_cmd.sh && npm start --silent
