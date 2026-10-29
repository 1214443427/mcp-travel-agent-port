import z from "zod";

type QueryOptions = Record<string, string | number | boolean | undefined>;

export function constructUrl(base: string, options: QueryOptions) {
  const endpoint = new URL(base);

  Object.entries(options).forEach(([key, value]) => {
    if (value !== undefined) {
      endpoint.searchParams.set(key, String(value));
    }
  });

  return endpoint;
}

export function parseData<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    console.error(z.prettifyError(result.error));
    throw new Error("The end point returned data with unexpected format.");
  }
  return result.data;
}
