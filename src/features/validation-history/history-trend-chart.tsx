"use client";

import {
  CategoryScale,
  Chart,
  Filler,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from "chart.js";
import { useEffect, useRef } from "react";

Chart.register(
  CategoryScale,
  Filler,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
);

export function HistoryTrendChart({
  points,
}: {
  points: Array<{ label: string; rate: number }>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    const chart = new Chart(canvasRef.current, {
      type: "line",
      data: {
        labels: points.map((point) => point.label),
        datasets: [
          {
            backgroundColor: "rgba(7, 92, 255, 0.08)",
            borderColor: "#075cff",
            borderWidth: 2,
            data: points.map((point) => point.rate),
            fill: true,
            pointBackgroundColor: "#075cff",
            pointBorderWidth: 0,
            pointRadius: 3,
            tension: 0.32,
          },
        ],
      },
      options: {
        animation: false,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (context) =>
                `${typeof context.parsed.y === "number" ? context.parsed.y.toFixed(1) : "0,0"}%`,
            },
          },
        },
        responsive: true,
        scales: {
          x: {
            border: { display: false },
            grid: { display: false },
            ticks: { color: "#61728e", font: { size: 9 } },
          },
          y: {
            border: { display: false },
            grid: { color: "rgba(198, 211, 229, 0.55)" },
            max: 100,
            min: 0,
            ticks: {
              callback: (value) => `${value}%`,
              color: "#61728e",
              font: { size: 9 },
              stepSize: 25,
            },
          },
        },
      },
    });

    return () => chart.destroy();
  }, [points]);

  return <canvas ref={canvasRef} role="img" aria-label="Tendência mensal de concordância entre IA e revisor" />;
}
