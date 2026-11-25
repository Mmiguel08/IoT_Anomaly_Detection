# IoT Anomaly Detection Dashboard

React + Vite dashboard for the ESP8266/DHT11 project. It reads sensor data from the existing AWS API Gateway endpoint.

## Architecture

ESP8266 → AWS IoT Core (MQTT) → IoT Rule → DynamoDB → Lambda (read-only) → API Gateway → this React dashboard.

The browser calls API Gateway directly. You do **not** need to run a separate backend server for local development.

## Requirements

- Node.js 20.19+ or 22.12+
- npm
- Internet connection
- Existing AWS API Gateway GET endpoint

## Run locally

1. Extract the ZIP.
2. Open a terminal in the extracted `iot-anomaly-dashboard` folder.
3. Install dependencies:

   ```bash
   npm install
   ```

4. Start the Vite development server:

   ```bash
   npm run dev
   ```

5. Open the local URL printed by Vite, usually `http://localhost:5173`.

The dashboard polls the API every 10 seconds.

## Build for production

```bash
npm run build
npm run preview
```

The production files are generated in `dist/`. They can be hosted using AWS Amplify Hosting, S3 + CloudFront, or another static hosting provider.

## AWS / CORS notes

The frontend calls:

`https://gmy2vap70a.execute-api.ap-south-1.amazonaws.com/dev/readings`

For browser requests from `localhost`, the API response must include an appropriate CORS header, at minimum:

`Access-Control-Allow-Origin: *`

For the current simple GET request, no custom request headers are needed. If the browser reports a CORS error, configure CORS on the API Gateway REST API and deploy the API again. With Lambda proxy integration, make sure the Lambda response also returns the CORS header, for example:

```python
"headers": {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*"
}
```

## Important security note

The current API method is configured with Authorization `NONE`. That means anyone who knows the endpoint may be able to read the returned sensor data. This may be acceptable for a temporary classroom demonstration with non-sensitive readings, but do not treat it as a production security design. Before public deployment, restrict access (for example, with Amazon Cognito/JWT authorization and suitable API resource controls), and restrict CORS to the actual dashboard domain. CORS is not authentication.

## Data assumptions

- The API returns `{ "deviceId": "...", "count": 0, "readings": [] }`.
- Each reading contains `temperature`, `humidity`, `anomaly`, `reason`, and `timestamp`.
- `timestamp` is Unix time in seconds.
- The anomaly table is derived from anomaly readings in the records returned by the API. The Lambda currently returns up to 50 records, so this is not a separate unlimited anomaly archive.
- Device online status is inferred from the timestamp of the newest returned reading and the 30-second timeout.
