import { throwError } from "@/errors/handlers";
import type { Context } from "hono";
import {
  DEFAULT_QUERY_LIMIT,
  INVALID_CHARS,
  MAX_QUERY_LIMIT,
} from "../constants";
import type { AuthType } from "../lib/create-app";
import { type OrderDirection, orderDirections } from "../types";

export const getUserId = async (c: Context<AuthType>): Promise<string> => {
  const userId = c.get("user")?.id;

  if (!userId) {
    throwError("UNAUTHORIZED", "Unauthorized access detected", "sessions.get");
  }

  return userId;
};

export const getPagination = (
  query: Record<string, string | undefined>,
  defaultLimit = DEFAULT_QUERY_LIMIT,
  maxLimit = MAX_QUERY_LIMIT,
) => {
  const rawLimit = Number.parseInt(query.limit || `${defaultLimit}`);
  const page = Math.max(Number.parseInt(query.page || "1"), 1);

  const safeLimit = Math.min(Math.max(rawLimit, 1), maxLimit);
  const offset = (page - 1) * safeLimit;

  return { offset, limit: safeLimit, page };
};

export const getOrderDirection = (
  query: Record<string, string | undefined>,
  source?: string,
): OrderDirection => {
  const orderBy = query?.orderBy as OrderDirection;

  if (orderBy && !orderDirections.includes(orderBy)) {
    throwError(
      "INVALID_PARAMETER",
      "Invalid order direction",
      source || "utils",
    );
  }

  return orderBy;
};

export const isInvalidName = (name: string) => {
  return INVALID_CHARS.test(name);
};

export const isValidDateString = (str: string) => {
  const date = new Date(str);
  return !Number.isNaN(date.getTime());
};

export const pick = <T, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> => {
  return Object.fromEntries(keys.map((key) => [key, obj[key]])) as Pick<T, K>;
};
