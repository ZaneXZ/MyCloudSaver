import { injectable } from "inversify";
import { createAxiosInstance } from "../utils/axiosInstance";
import { AxiosInstance } from "axios";
import sponsors from "../sponsors/sponsors.json";

@injectable()
export class SponsorsService {
  private axiosInstance: AxiosInstance;

  constructor() {
    this.axiosInstance = createAxiosInstance("http://oss.jiangmuxin.cn/cloudsaver/");
  }
  async getSponsors() {
    try {
      const response = await this.axiosInstance.get("sponsors.json");
      return {
        data: response.data.sponsors,
      };
    } catch (error) {
      return {
        data: sponsors.sponsors,
      };
    }
  }
}
