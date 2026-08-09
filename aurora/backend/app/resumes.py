"""Resume PDF parsing and AI scoring engine.

Parses the PDF with pdfplumber, then scores it with the Gemini fallback
chain against a JSON schema covering ATS compatibility, impact and keywords.
"""
from __future__ import annotations

import logging
from typing import Optional

import io

import pdfplumber

from app.gemini import client

logger = logging.getLogger("aurora.resumes")

RESUME_SYSTEM = (
    "You are an expert technical recruiter and ATS system. Analyze the "
    "resume text provided and return structured scoring. Be specific and "
    "honest — generic praise is not helpful."
)

RESUME_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "overall_score": {
            "type": "NUMBER",
            "description": "Score 0-100",
        },
        "ats_score": {
            "type": "NUMBER",
            "description": "ATS formatting compatibility 0-100",
        },
        "impact_score": {
            "type": "NUMBER",
            "description": "Measurable impact of achievements 0-100",
        },
        "keywords_score": {
            "type": "NUMBER",
            "description": "Keyword coverage for tech roles 0-100",
        },
        "summary": {"type": "STRING", "description": "2-3 sentence summary"},
        "strengths": {"type": "ARRAY", "items": {"type": "STRING"}},
        "weaknesses": {"type": "ARRAY", "items": {"type": "STRING"}},
        "top_keywords": {"type": "ARRAY", "items": {"type": "STRING"}},
        "suggestions": {"type": "ARRAY", "items": {"type": "STRING"}},
    },
    "required": [
        "overall_score", "ats_score", "impact_score", "keywords_score",
        "summary", "strengths", "weaknesses", "top_keywords", "suggestions",
    ],
}


def extract_pdf_text(pdf_bytes: bytes) -> str:
    text_parts = []
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            page_text = page.extract_text()
            if page_text:
                text_parts.append(page_text)
    return "\n".join(text_parts)


async def score_resume(text: str) -> Optional[tuple[dict, str]]:
    """Returns (analysis_dict, model_used) or None if all models fail."""
    result = await client.generate_with_fallback(
        messages=[{"role": "user", "text": f"Resume text:\n\n{text}"}],
        system=RESUME_SYSTEM,
        temperature=0.3,
        response_schema=RESUME_SCHEMA,
    )
    if not result.text:
        return None
    import json
    try:
        analysis = json.loads(result.text)
    except json.JSONDecodeError:
        logger.error("resume score output was not JSON")
        return None
    return analysis, result.model_used
