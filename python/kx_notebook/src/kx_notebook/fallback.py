"""Export-safe HTML, text, and no-network static chart fallbacks."""

from __future__ import annotations

import datetime as dt
import html
import math
from typing import Any, Mapping, Optional


def static_html(payload: Mapping[str, Any]) -> str:
    columns = payload["schema"]["columns"]
    rows = payload["data"]["rows"]
    result = payload["result"]
    provenance = payload["provenance"]
    schema_text = ", ".join(
        f"{column['name']} ({column['type']})" for column in columns
    )
    notices = _notices(result)

    parts = [
        '<div class="kx-result" data-kx-result-version="1">',
        "<style>",
        ".kx-result{font:13px system-ui,sans-serif;color:#202124;max-width:100%;}",
        ".kx-result .kx-meta,.kx-result .kx-schema,.kx-result .kx-notice{margin:.3rem 0;}",
        ".kx-result pre{overflow:auto;padding:.4rem .55rem;background:#f6f8fa;}",
        ".kx-result .kx-notice{padding:.4rem .55rem;border-left:3px solid #b7791f;background:#fff8e1;}",
        ".kx-result .kx-table-wrap{overflow:auto;max-height:28rem;border:1px solid #d0d7de;}",
        ".kx-result table{border-collapse:collapse;width:max-content;min-width:100%;}",
        ".kx-result th,.kx-result td{padding:.25rem .5rem;border-bottom:1px solid #d8dee4;text-align:left;white-space:pre-wrap;vertical-align:top;}",
        ".kx-result th{position:sticky;top:0;background:#f6f8fa;font-weight:600;}",
        ".kx-result svg{display:block;max-width:100%;height:auto;margin:.65rem 0;border:1px solid #d0d7de;background:#fff;}",
        "</style>",
        '<div class="kx-meta"><strong>KX q result</strong>',
    ]
    label = provenance.get("label")
    if label:
        parts.append(f" — {html.escape(str(label))}")
    elapsed = provenance.get("elapsedMs")
    if elapsed is not None:
        parts.append(f" · {html.escape(_number_text(elapsed))} ms")
    parts.extend(
        [
            "</div>",
            '<div class="kx-schema"><strong>Schema:</strong> ',
            html.escape(schema_text or "(no columns)"),
            "</div>",
            '<div class="kx-meta">',
            f"Rows: {int(result['rowCount'])}; preview: {int(result['previewRowCount'])}",
            "</div>",
        ]
    )
    if provenance.get("qSource"):
        parts.extend(
            [
                "<details><summary>q source</summary><pre>",
                html.escape(str(provenance["qSource"])),
                "</pre></details>",
            ]
        )
    for notice in notices:
        parts.append(f'<div class="kx-notice">{html.escape(notice)}</div>')
    if "chart" in payload:
        parts.append(_static_svg(payload))
    parts.append('<div class="kx-table-wrap"><table><thead><tr>')
    for column in columns:
        parts.append(f"<th>{html.escape(str(column['name']))}</th>")
    parts.append("</tr></thead><tbody>")
    for row in rows:
        parts.append("<tr>")
        for cell in row:
            parts.append(f"<td>{html.escape(_cell_text(cell))}</td>")
        parts.append("</tr>")
    if not rows:
        colspan = max(1, len(columns))
        parts.append(f'<tr><td colspan="{colspan}">(no preview rows)</td></tr>')
    parts.append("</tbody></table></div></div>")
    return "".join(parts)


def static_text(payload: Mapping[str, Any]) -> str:
    columns = payload["schema"]["columns"]
    rows = payload["data"]["rows"]
    result = payload["result"]
    provenance = payload["provenance"]
    heading = "KX q result"
    if provenance.get("label"):
        heading += f" — {provenance['label']}"
    if provenance.get("elapsedMs") is not None:
        heading += f" · {_number_text(provenance['elapsedMs'])} ms"
    lines = [
        heading,
        "Schema: "
        + (
            ", ".join(f"{column['name']} ({column['type']})" for column in columns)
            or "(no columns)"
        ),
        f"Rows: {result['rowCount']}; preview: {result['previewRowCount']}",
    ]
    if provenance.get("qSource"):
        lines.extend(["q source:", str(provenance["qSource"])])
    lines.extend(f"Notice: {notice}" for notice in _notices(result))
    chart = payload.get("chart")
    if chart:
        chart_title = f" ({chart['title']})" if chart.get("title") else ""
        lines.append(
            f"Static chart{chart_title}: {chart['type']}; x={chart['xColumn']}; "
            f"y={','.join(chart['yColumns'])} (see the HTML/SVG fallback)"
        )
    lines.append("\t".join(str(column["name"]) for column in columns))
    lines.extend("\t".join(_plain_cell_text(cell) for cell in row) for row in rows)
    if not rows:
        lines.append("(no preview rows)")
    return "\n".join(lines)


def _notices(result: Mapping[str, Any]) -> list[str]:
    reasons = list(result.get("truncationReasons", ()))
    notices: list[str] = []
    if "rowLimit" in reasons:
        notices.append(
            f"Preview limited to at most {result['rowLimit']} rows; the full result is not embedded in this notebook."
        )
    if "byteLimit" in reasons:
        notices.append(
            f"Preview reduced to stay within the {result['byteLimit']}-byte portable output limit."
        )
    if "cellValueLimit" in reasons:
        notices.append(
            "One or more cell strings were shortened for portable output safety."
        )
    if "sourcePreview" in reasons:
        notices.append(
            "The publisher supplied a bounded source preview; omitted rows are not embedded in this notebook."
        )
    if result.get("truncated") and not notices:
        notices.append(
            "This notebook contains a bounded preview, not the full live result."
        )
    return notices


def _cell_text(cell: Mapping[str, Any]) -> str:
    kind = cell.get("kind")
    if kind == "null":
        return "null"
    value = cell.get("value")
    if kind == "json":
        return str(value)
    if kind == "boolean":
        return "true" if value else "false"
    return str(value)


def _plain_cell_text(cell: Mapping[str, Any]) -> str:
    return _cell_text(cell).replace("\r", " ").replace("\n", " ").replace("\t", " ")


def _number_text(value: Any) -> str:
    number = float(value)
    return (
        str(int(number))
        if number.is_integer()
        else f"{number:.3f}".rstrip("0").rstrip(".")
    )


def _static_svg(payload: Mapping[str, Any]) -> str:
    chart = payload["chart"]
    columns = [column["name"] for column in payload["schema"]["columns"]]
    rows = payload["data"]["rows"]
    x_index = columns.index(chart["xColumn"])
    y_indexes = [columns.index(name) for name in chart["yColumns"]]
    series: list[tuple[str, list[tuple[float, float]]]] = []
    for y_name, y_index in zip(chart["yColumns"], y_indexes):
        points: list[tuple[float, float]] = []
        for row_index, row in enumerate(rows):
            x = _chart_number(row[x_index], fallback=float(row_index))
            y = _chart_number(row[y_index])
            if x is not None and y is not None:
                points.append((x, y))
        series.append((y_name, points))

    all_points = [point for _, points in series for point in points]
    width, height = 720, 260
    left, right, top, bottom = 52, 16, 26, 38
    plot_width, plot_height = width - left - right, height - top - bottom
    title = chart.get("title") or f"{chart['type']} chart"
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" role="img" '
        f'aria-label="{html.escape(str(title), quote=True)}">',
        f"<title>{html.escape(str(title))}</title>",
        f'<rect x="0" y="0" width="{width}" height="{height}" fill="#fff"/>',
        f'<text x="{left}" y="17" font-family="system-ui,sans-serif" font-size="13" fill="#202124">{html.escape(str(title))}</text>',
    ]
    if not all_points:
        parts.append(
            f'<text x="{width / 2}" y="{height / 2}" text-anchor="middle" '
            'font-family="system-ui,sans-serif" font-size="13" fill="#57606a">'
            "No chartable preview points</text></svg>"
        )
        return "".join(parts)
    x_values = [point[0] for point in all_points]
    y_values = [point[1] for point in all_points]
    x_min, x_max = _nonzero_domain(min(x_values), max(x_values))
    y_min, y_max = _nonzero_domain(min(y_values), max(y_values))

    def px(value: float) -> float:
        return left + (value - x_min) / (x_max - x_min) * plot_width

    def py(value: float) -> float:
        return top + plot_height - (value - y_min) / (y_max - y_min) * plot_height

    parts.extend(
        [
            f'<line x1="{left}" y1="{top}" x2="{left}" y2="{top + plot_height}" stroke="#8c959f"/>',
            f'<line x1="{left}" y1="{top + plot_height}" x2="{left + plot_width}" y2="{top + plot_height}" stroke="#8c959f"/>',
            f'<text x="4" y="{top + 10}" font-family="system-ui,sans-serif" font-size="10" fill="#57606a">{html.escape(_axis_text(y_max))}</text>',
            f'<text x="4" y="{top + plot_height}" font-family="system-ui,sans-serif" font-size="10" fill="#57606a">{html.escape(_axis_text(y_min))}</text>',
            f'<text x="{left}" y="{height - 8}" font-family="system-ui,sans-serif" font-size="10" fill="#57606a">{html.escape(str(chart["xColumn"]))}</text>',
        ]
    )
    colors = ("#0969da", "#cf222e", "#1a7f37", "#8250df", "#9a6700", "#0550ae")
    legend_x = left + 90
    for series_index, (name, points) in enumerate(series):
        color = colors[series_index % len(colors)]
        if chart["type"] == "scatter":
            for x, y in points:
                parts.append(
                    f'<circle cx="{px(x):.2f}" cy="{py(y):.2f}" r="2.5" fill="{color}"/>'
                )
        elif chart["type"] == "bar":
            bar_width = max(2.0, min(16.0, plot_width / max(1, len(points)) * 0.55))
            zero_y = py(0.0) if y_min <= 0 <= y_max else py(y_min)
            for x, y in points:
                y_px = py(y)
                parts.append(
                    f'<rect x="{px(x) - bar_width / 2:.2f}" y="{min(y_px, zero_y):.2f}" '
                    f'width="{bar_width:.2f}" height="{max(1.0, abs(zero_y - y_px)):.2f}" fill="{color}" opacity=".82"/>'
                )
        else:
            draw_points = points
            if chart["type"] == "step" and points:
                stepped = [points[0]]
                for previous, current in zip(points, points[1:]):
                    stepped.append((current[0], previous[1]))
                    stepped.append(current)
                draw_points = stepped
            point_text = " ".join(f"{px(x):.2f},{py(y):.2f}" for x, y in draw_points)
            parts.append(
                f'<polyline points="{point_text}" fill="none" stroke="{color}" stroke-width="1.7"/>'
            )
        parts.append(
            f'<text x="{legend_x}" y="17" font-family="system-ui,sans-serif" font-size="10" fill="{color}">'
            f"{html.escape(str(name))}</text>"
        )
        legend_x += min(120, 14 + len(str(name)) * 7)
    parts.append("</svg>")
    return "".join(parts)


def _chart_number(
    cell: Mapping[str, Any], fallback: Optional[float] = None
) -> Optional[float]:
    kind = cell.get("kind")
    value = cell.get("value")
    if kind == "number":
        number = float(value)
        return number if math.isfinite(number) else None
    if kind == "bigint":
        try:
            number = float(value)
        except (TypeError, ValueError, OverflowError):
            return None
        return number if math.isfinite(number) else None
    if kind == "temporal" or (kind == "string" and isinstance(value, str)):
        parsed = _temporal_number(str(value))
        if parsed is not None:
            return parsed
    return fallback


def _temporal_number(value: str) -> Optional[float]:
    candidate = value.replace("Z", "+00:00")
    try:
        if "T" in candidate or " " in candidate:
            parsed = dt.datetime.fromisoformat(candidate)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=dt.timezone.utc)
            return parsed.timestamp() * 1000
        return (
            dt.datetime.combine(
                dt.date.fromisoformat(candidate), dt.time(), tzinfo=dt.timezone.utc
            ).timestamp()
            * 1000
        )
    except ValueError:
        return None


def _nonzero_domain(minimum: float, maximum: float) -> tuple[float, float]:
    if minimum != maximum:
        return minimum, maximum
    padding = abs(minimum) * 0.01 or 1.0
    return minimum - padding, maximum + padding


def _axis_text(value: float) -> str:
    if abs(value) >= 1_000_000 or (value and abs(value) < 0.001):
        return f"{value:.3g}"
    return f"{value:.4f}".rstrip("0").rstrip(".")
