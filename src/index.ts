#!/usr/bin/env node
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import { z } from "zod";
import { constructUrl, parseData } from "./utils.js";
import { LatLonSchema, WeatherSchema } from "./type.js";
import { WEATHER_API_KEY } from "./config.js";
import { fetchAPI } from "./fetching.js";
import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler } from "@modelcontextprotocol/server";
 
function createServer() {
  const server = new McpServer({
    name: "mcp-travel-agent-port",
    version: "1.0.0",
  });

  // --- Tools -----------------------------------------------------------------

  server.registerTool(
    "get_lat_lon",
    {
      title: "Get Lat Lon",
      description: "Return the latitude and longitude of a city",
      inputSchema: z.object({
        city: z.string().describe("The name of the city to search for. "),
        countryCode: z.string().nullable().describe("ISO country code. e.g. GB"),
      }),
    },
    async ({ city, countryCode }) => {
      const query = countryCode ? city + "," + countryCode : city;
      const baseURL = "https://api.openweathermap.org/geo/1.0/direct";
      const fullURL = constructUrl(baseURL, { q: query, appid: WEATHER_API_KEY });
      const latLonData = await fetchAPI(fullURL);
      const parseResult = parseData(LatLonSchema, latLonData);
      return {
        content: [{ type: "text", text: JSON.stringify(parseResult) }],
      };
    },
  );

  server.registerTool(
    "get_weather",
    {
      title: "Get weather",
      description: "Return the weather for a given location.",

      inputSchema: z.object({
        lat: z.number().describe("The latitude of the city"),
        lon: z.number().describe("The longitude of the city"),
        unit: z
          .string()
          .nullable()
          .describe(
            "Unit of measurement. 'metric' and 'imperial' units are available. Defaults to 'metric'.",
          ),
      }),
    },
    async ({ lat, lon, unit }) => {
      const unitCleaned = unit == "imperial" ? "imperial" : "metric";
      const baseURL = "https://api.openweathermap.org/data/2.5/weather";
      const options = {
        lat,
        lon,
        appid: WEATHER_API_KEY,
        units: unitCleaned,
      };
      const fullUrl = constructUrl(baseURL, options);
      const data = await fetchAPI(fullUrl);
      const parsedData = parseData(WeatherSchema, data);
      const filteredResult = {
        weather: parsedData.weather[0].main,
        weatherDescription: parsedData.weather[0].description,
        temp: parsedData.main.temp,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(filteredResult) }],
      };
    },
  );

  // --- Resources -------------------------------------------------------------

  server.registerResource(
    "destination",
    new ResourceTemplate("travel://destinations/{city}", { list: undefined }),
    {
      title: "Destination info",
      description: "Basic placeholder information about a destination city",
    },
    async (uri, { city }) => ({
      contents: [
        {
          uri: uri.href,
          text: `Destination: ${city}\n(Placeholder data — wire up a real data source here.)`,
        },
      ],
    }),
  );

  // --- Prompts ---------------------------------------------------------------

  server.registerPrompt(
    "plan_trip",
    {
      title: "Plan a trip",
      description: "Asks the model to draft a short itinerary",
      argsSchema: z.object({
        destination: z.string(),
        days: z.string().describe("Number of days"),
      }),
    },
    ({ destination, days }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `This is a test MCP server. If you see this, list out the end points available to you and call them. Report if each worked as expected.`,
          },
        },
      ],
    }),
  );
  return server;
}

// --- Start -----------------------------------------------------------------

const app = createMcpExpressApp();
const handler = toNodeHandler(createMcpHandler(() => createServer()));

app.all("/mcp", (req, res) => handler(req, res, req.body));

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, "127.0.0.1", () => {
  console.log(`Weather MCP server listening on http://localhost:${PORT}/mcp`);
});

console.error("mcp-travel-agent-port running on http");
