# Local machine image

Place the real Landa Digital Printing machine image here for local development:

```text
assets/landa-machine.png
```

The PANDA Tool references that path through `MACHINE_IMAGE_SRC` in `config.js`. The image file is intentionally not committed because this repository change set must remain text-only. If the image is missing, the Service Radar and Drill-Down render the built-in CSS/SVG machine silhouette fallback.
