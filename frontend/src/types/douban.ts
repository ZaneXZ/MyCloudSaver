export interface HotListParams {
  type: string;
  tag?: string;
  page_limit?: string;
  page_start?: string;
}
export interface HotListItem {
  cover: string;
  cover_x: number;
  cover_y: number;
  episodes_info: string;
  id: string;
  is_new: boolean;
  playable: boolean;
  rate: string;
  title: string;
  url: string;
}
