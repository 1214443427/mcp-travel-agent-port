import * as z from "zod";

const earliestToday = () =>
  new Date(Date.now()).toLocaleDateString("en-CA", { timeZone: "Etc/GMT+12" });

export const FormSchema = z
  .object({
    travelerCount: z.coerce.number().int().min(1).max(10),
    from: z.string().nonempty("Please state your origin location."),
    to: z.string().nonempty("Please state your desired destination."),
    startDate: z.iso
      .date("Please set a date in mm/dd/yyyy format.")
      .refine((date) => date >= earliestToday(), "Start date must be greater or equal to today"),
    endDate: z.iso.date("Please set a date in mm/dd/yyyy format."),
    budget: z
      .string()
      .min(1, "Please set a budget.")
      .pipe(
        z.coerce
          .number<string>("Must be a number")
          .positive("Please set a positive number as budget."),
      ),
  })
  .refine((data) => data.endDate >= data.startDate, {
    error: "End date must be greater than start date",
    path: ["endDate"],
  });

export type FormInputData = z.infer<typeof FormSchema>;

const FlightAction = z.object({
  type: z.literal("book_flight"),
  flightRef: z
    .string()
    .describe("The `ref` value shown on the chosen flight option in context, e.g. 'flt_3'."),
});

const HotelAction = z.object({
  type: z.literal("book_hotel"),
  ref: z.string().describe("The `ref` value shown on the chosen hotel in context, e.g. 'htl_3'."),
});

const AttractionAction = z.object({
  type: z.literal("view_attraction"),
  wikipedia: z
    .string()
    .describe("Verbatim `wikipedia` field from get_attractions, e.g. 'en:Foley Square'."),
});

export const EventSchema = z.object({
  title: z.string().describe("The name of the event. E.g. Weather, Flights, Hotel, etc"),
  description: z
    .string()
    .describe(
      "An one sentence description of the event. This will be shown to the user, keep the content concise and easy to read. Do not include any action data such as URL link to wikipedia in here. For example: 'The best option for you is with Delta Airlines with a layover in Oslo.', 'Visit the Temple of Heaven early, then head to the Summer Palace once the crowds pick up.'",
    ),
  action: z
    .discriminatedUnion("type", [FlightAction, HotelAction, AttractionAction])
    .describe("Only include for flights, hotel stays, and tourist attractions.")
    .nullable(),
});

export type EventData = z.infer<typeof EventSchema>;

export const FlightHandleSchema = z.object({
  kind: z.enum(["next", "booking", "details"]),
  token: z.string(),
});

export const HotelHandleSchema = z.object({
  kind: z.literal("hotel"),
  token: z.string(),
  checkIn: z.iso.date(),
  checkOut: z.iso.date(),
  adults: z.number().int().min(1),
});

export const BookingHandleSchema = z.discriminatedUnion("kind", [
  FlightHandleSchema,
  HotelHandleSchema,
]);

export type BookingHandle = z.infer<typeof BookingHandleSchema>;
export type HotelHandle = z.infer<typeof HotelHandleSchema>;

// export const TravelAgentContextSchema = z.object({
//   refs: z.map(z.string(), BookingHandleSchema),
// });
export type TravelAgentContext = {
  refs: Map<string, BookingHandle>;
};
// { refs: Map<string, BookingHandle> };

const RefsWireSchema = z.record(z.string(), BookingHandleSchema);

export const ModelOutputSchema = z.object({
  events: z
    .array(EventSchema)
    .describe(
      "An array of cards to render. Including weather, transit, hotel stay, activities for the user, etc.",
    ),
});

export const ResponseSchema = ModelOutputSchema.extend({
  startDate: z.string().describe("Should match the ones given in the prompt."),
  endDate: z.string().describe("Should match the ones given in the prompt."),
  startLocation: z.string().describe("Should match the ones given in the prompt."),
  endLocation: z.string().describe("Should match the ones given in the prompt."),
  personCount: z.number(),
  refs: RefsWireSchema,
});

// export const ModelOutputSchema = ResponseSchema.omit({ refs: true });
export type ResponseData = z.infer<typeof ResponseSchema>;

export type ModelOutput = z.infer<typeof ModelOutputSchema>;

export class APIError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super();
    this.code = code;
    this.message = message;
  }
}

export type FormState =
  | {
      phase: "initial";
      prevData?: FormData;
    }
  | {
      phase: "invalid";
      error: z.ZodError<FormInputData>;
      prevData: FormData;
    }
  | {
      phase: "error";
      error: APIError;
      prevData: FormData;
    };

export class FetchError extends Error {
  status: number | null;
  url: string;
  constructor(status: number | null, message: string, url: string, cause?: unknown) {
    super(message, { cause });
    this.status = status;
    this.url = url;
  }

  get retryable() {
    return this.status === null || this.status === 429 || this.status >= 500;
  }
}

export const LatLonSchema = z.array(
  z.object({
    name: z.string(),
    lat: z.number(),
    lon: z.number(),
    country: z.string(),
    state: z.string().nullish(),
  }),
);

export const WeatherSchema = z.object({
  weather: z
    .array(
      z.object({
        main: z.string(),
        description: z.string(),
      }),
    )
    .min(1),
  main: z.object({
    temp: z.number(),
  }),
});

export const AirportSchema = z.object({
  data: z.array(
    z.object({
      title: z.string(),
      city: z.string(),
      list: z.array(
        z.object({
          id: z.string(),
          type: z.string(),
          title: z.string(),
          city: z.string(),
        }),
      ),
    }),
  ),
});

const FlightSegmentAirportSchema = z.object({
  airport_name: z.string(),
  airport_code: z.string(),
  time: z.string(),
});

const FlightItinerarySchema = z.object({
  departure_time: z.string(),
  arrival_time: z.string(),
  duration: z.object({ raw: z.number(), text: z.string() }),
  price: z.number(),
  flights: z.array(
    z.object({
      departure_airport: FlightSegmentAirportSchema,
      arrival_airport: FlightSegmentAirportSchema,
      duration: z.object({ raw: z.number(), text: z.string() }),
      airline: z.string(),
    }),
  ),
  layovers: z
    .array(
      z.object({
        airport_code: z.string(),
        airport_name: z.string(),
        duration: z.number(),
      }),
    )
    .nullable(),
  booking_token: z.string().nullish(),
  next_token: z.string().nullish(),
});

const FlightListSchema = z
  .array(FlightItinerarySchema.nullable().catch(null))
  .transform((arr) => arr.filter((flight) => flight != null));

export const FlightSchema = z.object({
  data: z.object({
    itineraries: z.object({
      topFlights: FlightListSchema.optional(),
      otherFlights: FlightListSchema.optional(),
    }),
  }),
});

const HotelTimeSchema = z.object({
  from: z.string(),
  until: z.string(),
});

const HotelSchema = z.object({
  hotel_id: z.number(),
  hotel_name: z.string(),
  review_score: z.number().nullish(),
  review_nr: z.number().nullish(),
  checkout: HotelTimeSchema,
  checkin: HotelTimeSchema,
  hotel_name_trans: z.string().nullish(),
  composite_price_breakdown: z.object({
    all_inclusive_amount: z.object({ currency: z.string(), value: z.number() }),
  }),
  class: z.number(),
});

export const HotelsSchema = z.object({
  data: z.object({
    result: z
      .array(HotelSchema.nullable().catch(null))
      .transform((array) => array.filter((element) => element !== null)),
    // Catching error to avoid a single bad object ruining the whole array. Converts elements that did not fit the hotel schema into null filter the array to remove null
  }),
});

export const PlacesSchema = z.object({
  features: z
    .array(
      z
        .object({
          properties: z.object({
            name: z.string(),
            name_international: z.object({ en: z.string().nullish() }).nullish(),
            website: z.string().nullish(),
            opening_hours: z.string().nullish(),
            categories: z.array(z.string()),
            descriptions: z.string().nullish(),
            wiki_and_media: z
              .object({
                wikipedia: z.string().nullish(),
              })
              .nullish(),
          }),
        })
        .nullable()
        .catch(null),
    )
    .transform((array) => array.filter((element) => element !== null)),
});

export const TripStreamSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("tool_started"), tool: z.string() }),
  z.object({ type: z.literal("tool_finished"), tool: z.string() }),
  z.object({ type: z.literal("done"), output: ResponseSchema }),
  z.object({ type: z.literal("error"), code: z.number().nullish(), message: z.string() }),
]);

export type TripStream = z.infer<typeof TripStreamSchema>;

export type ErrorMessages = { credentials: string; retryable: string; generic: string };

const FlightOffersSchema = z.object({
  title: z.string(),
  cabin: z.string().optional(),
  price: z.number(),
  meta: z
    .object({
      features: z.array(z.string()),
    })
    .nullable(),
  is_airline: z.boolean(),
  token: z.string(),
});

export const FlightDetailsSchema = z.object({
  data: z
    .array(FlightOffersSchema.nullable().catch(null))
    .transform((flights) => flights.filter((flight) => flight !== null)),
});

export type FlightDetails = z.infer<typeof FlightDetailsSchema>;

export const HotelApiRequestSchema = z.object({
  token: z.string(),
  arrivalDate: z.iso.date(),
  departureDate: z.iso.date(),
  adults: z.number(),
});

export type HotelApiRequest = z.infer<typeof HotelApiRequestSchema>;

export const HotelApiResponseSchema = z.object({
  url: z.httpUrl(),
  hotelName: z.string(),
  address: z.string().nullish(),
  totalPrice: z.string(),
  propertyHighlight: z.array(z.string()).catch([]),
});

export type HotelDetails = z.infer<typeof HotelApiResponseSchema>;

export type BookingStates =
  | { state: "init" }
  | {
      state: "error";
      message: string;
    }
  | {
      state: "flight";
      data: FlightDetails;
    }
  | {
      state: "hotel";
      data: HotelDetails;
    };

export const BookingApiRequestSchema = z.object({
  token: z.string(),
});

export type BookingApiType = z.infer<typeof BookingApiRequestSchema>;

export const BookingApiResponseSchema = z.object({
  data: z.httpUrl(),
});

export const HotelDetailsSchema = z.object({
  data: z.object({
    hotel_name: z.string(),
    url: z.httpUrl(),
    address: z.string(),
    composite_price_breakdown: z.object({
      all_inclusive_amount: z.object({
        currency: z.string(),
        amount_rounded: z.string(),
      }),
    }),
    property_highlight_strip: z.array(
      z.object({
        name: z.string(),
      }),
    ),
  }),
});
