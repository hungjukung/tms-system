import axios from "axios";

export const apiClient = axios.create({ baseURL: import.meta.env.VITE_API_BASE_URL ?? "/api" });

apiClient.interceptors.request.use((config) => {
  const token = sessionStorage.getItem("tms_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      sessionStorage.removeItem("tms_token");
      sessionStorage.removeItem("tms_user");
      window.location.href = "/login";
    }
    return Promise.reject(err);
  },
);

export async function openPrintWindow(url: string) {
  const res = await apiClient.get(url, { responseType: "text" });
  const win = window.open("", "_blank", "width=420,height=600");
  if (!win) {
    alert("瀏覽器封鎖了新視窗，請允許彈出視窗以列印");
    return;
  }
  win.document.open();
  win.document.write(res.data);
  win.document.close();
}
