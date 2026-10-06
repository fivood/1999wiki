/* 站点挂在主站子路径（见 site-base.mjs）；站内绝对路径都经 BASE 拼接 */
export const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

/** 去掉 BASE 前缀后的路径段：/archive/角色/x → ['角色', 'x'] */
export const segs = (pathname: string) => decodeURI(pathname).slice(BASE.length).split('/').filter(Boolean);
