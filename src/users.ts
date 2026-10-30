import { Router } from "express";
import type { User } from "./type.js";

// Sample data for testing; replace with a real data source.
const users: User[] = [
  {
    id: "u1",
    name: "Alex Rivera",
    passportCountry: "US",
    homeAirport: "SFO",
    budgetPerDay: 200,
    currency: "USD",
    dietary: ["vegetarian"],
    pace: "moderate",
  },
  {
    id: "u2",
    name: "Sam Okafor",
    passportCountry: "GB",
    homeAirport: "LHR",
    budgetPerDay: 120,
    currency: "GBP",
    dietary: [],
    pace: "packed",
  },
];

export const usersRouter = Router();

usersRouter.get("/", (_req, res) => {
  res.json(users);
});

usersRouter.get("/:id", (req, res) => {
  const user = users.find((u) => u.id === req.params.id);
  if (!user) {
    res.status(404).json({ error: `User ${req.params.id} not found` });
    return;
  }
  res.json(user);
});
