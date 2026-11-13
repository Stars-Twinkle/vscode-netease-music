import qrcode from "qrcode-generator";

/**
 * 生成扫码登录用的二维码 SVG。
 * 用 scalable 版本交给 CSS 定尺寸，侧边栏改宽度时不会糊。
 */
export function renderQrSvg(text: string): string {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ scalable: true });
}
