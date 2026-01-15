import { Request, Response } from "express";
import { ApiResponse } from "../core/ApiResponse";
interface ApiResponseData<T> {
  data?: T;
  message?: string;
}

export abstract class BaseController {
  protected async handleRequest<T>(
    req: Request,
    res: Response,
    action: () => Promise<ApiResponseData<T> | void>
  ): Promise<void> {
    try {
      const result = await action();
      if (result) {
        res.json(ApiResponse.success(result.data, result.message));
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "未知错误";
      res.status(200).json(ApiResponse.error(errorMessage));
    }
  }
}
