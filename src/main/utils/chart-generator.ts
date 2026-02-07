/* Simple SVG chart generators used by tests */

export interface BarChartData {
  label: string;
  value: number;
  color?: string;
}

export interface LineChartDataPoint {
  x: number;
  y: number;
}

export interface ChartDimensions {
  width?: number;
  height?: number;
  marginTop?: number;
  marginRight?: number;
  marginBottom?: number;
  marginLeft?: number;
}

export class ChartGenerator {
  protected width: number;
  protected height: number;
  protected margin = { top: 40, right: 20, bottom: 40, left: 50 };

  constructor(dim?: ChartDimensions) {
    this.width = dim?.width ?? 600;
    this.height = dim?.height ?? 300;
    if (dim?.marginTop != null) this.margin.top = dim.marginTop;
    if (dim?.marginRight != null) this.margin.right = dim.marginRight;
    if (dim?.marginBottom != null) this.margin.bottom = dim.marginBottom;
    if (dim?.marginLeft != null) this.margin.left = dim.marginLeft;
  }

  protected esc(text: string): string {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  protected header(title: string): string {
    return `<text x="${this.width / 2}" y="${this.margin.top / 2}" text-anchor="middle" font-size="16" font-weight="bold">${
      this.esc(title)
    }</text>`;
  }

  protected yAxisLabel(label: string): string {
    const x = 15;
    const y = this.height / 2;
    return `<text x="${x}" y="${y}" transform="rotate(-90 ${x},${y})" text-anchor="middle">${this.esc(
      label
    )}</text>`;
  }
}

export class ColumnChartGenerator extends ChartGenerator {
  private defaultColor = '#4A90E2';

  generate(data: BarChartData[], title: string, yAxisLabel: string): string {
    const w = this.width;
    const h = this.height;

    const content = () => {
      if (!data || data.length === 0) {
        return `<text x="${w / 2}" y="${h / 2}" text-anchor="middle">${this.esc(
          'Empty Chart - No Data'
        )}</text>`;
      }

      const maxVal = Math.max(...data.map((d) => d.value), 1);
      const innerW = w - this.margin.left - this.margin.right;
      const innerH = h - this.margin.top - this.margin.bottom;
      const barW = innerW / data.length;

      const bars = data
        .map((d, i) => {
          const bh = (d.value / maxVal) * innerH;
          const x = this.margin.left + i * barW + barW * 0.1;
          const y = this.margin.top + (innerH - bh);
          const width = barW * 0.8;
          const color = d.color || this.defaultColor;
          return `
            <rect x="${x}" y="${y}" width="${width}" height="${bh}" fill="${color}" />
            <text x="${x + width / 2}" y="${h - this.margin.bottom / 2}" text-anchor="middle" font-size="12">${this.esc(
            d.label
          )}</text>`;
        })
        .join('');

      return bars;
    };

    return `
<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${this.esc(
      title
    )}">
  ${this.header(title)}
  ${this.yAxisLabel(yAxisLabel)}
  ${content()}
</svg>`;
  }
}

export class LineChartGenerator extends ChartGenerator {
  private stroke = '#4A90E2';

  generate(
    data: LineChartDataPoint[],
    title: string,
    xAxisLabel: string,
    yAxisLabel: string
  ): string {
    const w = this.width;
    const h = this.height;

    const innerW = w - this.margin.left - this.margin.right;
    const innerH = h - this.margin.top - this.margin.bottom;

    const content = () => {
      if (!data || data.length === 0) {
        return `<text x="${w / 2}" y="${h / 2}" text-anchor="middle">${this.esc(
          'Empty Chart - No Data'
        )}</text>`;
      }

      const maxX = Math.max(...data.map((d) => d.x), 1);
      const maxY = Math.max(...data.map((d) => d.y), 1);

      const scaleX = (x: number) =>
        this.margin.left + (x / (maxX || 1)) * innerW;
      const scaleY = (y: number) => this.margin.top + innerH - (y / (maxY || 1)) * innerH;

      const pathD = data
        .map((d, i) => `${i === 0 ? 'M' : 'L'} ${scaleX(d.x)} ${scaleY(d.y)}`)
        .join(' ');

      const circles = data
        .map(
          (d) =>
            `<circle cx="${scaleX(d.x)}" cy="${scaleY(d.y)}" r="3" fill="#ffffff" stroke="${this.stroke}" />`
        )
        .join('');

      return `
        <path d="${pathD}" fill="none" stroke="${this.stroke}" stroke-width="2" />
        ${circles}
      `;
    };

    return `
<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${this.esc(
      title
    )}">
  ${this.header(title)}
  ${this.yAxisLabel(yAxisLabel)}
  ${content()}
  <text x="${w / 2}" y="${h - 5}" text-anchor="middle" font-size="12">${this.esc(
      xAxisLabel
    )}</text>
</svg>`;
  }
}

