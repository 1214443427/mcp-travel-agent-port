import dotenv from "dotenv";
dotenv.config();

export const WEATHER_API_KEY = process.env.WEATHER_API;
if (WEATHER_API_KEY === undefined) {
  throw new Error("Missing Weather API Key");
}

const RAPID_KEY = process.env.RAPID_API_KEY;
if (RAPID_KEY === undefined) {
  throw new Error("Missing Rapid API Key");
}
export const RAPID_API_KEY = RAPID_KEY;

export const GEOAPIFY_KEY = process.env.GEOAPIFY_KEY;
if (GEOAPIFY_KEY === undefined) {
  throw new Error("Missing GEOAPIFY API Key");
}
