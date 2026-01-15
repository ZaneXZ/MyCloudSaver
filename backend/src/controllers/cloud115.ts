import { Cloud115Service } from "../services/Cloud115Service";
import { injectable, inject } from "inversify";
import { TYPES } from "../core/types";
import { BaseCloudController } from "./BaseCloudController";

@injectable()
export class Cloud115Controller extends BaseCloudController {
  constructor(@inject(TYPES.Cloud115Service) cloud115Service: Cloud115Service) {
    super(cloud115Service);
  }
}
