export const DEFAULT_GRAPH_CONFIG = {
    "collapse-filter": false,
    "search": "",
    "showTags": false,
    "showAttachments": false,
    "hideUnresolved": false,
    "showOrphans": true,
    "collapse-color-groups": true,
    "collapse-display": true,
    "showArrow": true,
    "textFadeMultiplier": 0.5,
    "nodeSizeMultiplier": 1.5,
    "lineSizeMultiplier": 4,
    "collapse-forces": true,
    "centerStrength": 0.8,
    "repelStrength": 13,
    "linkStrength": 1,
    "linkDistance": 100,
    "scale": 1.4,

    "localJumps": 2,
    "localBacklinks": true,
    "localForelinks": true,
    "localInterlinks": true,
    
    "colorGroups": [
        {
            "query": "[\"potentiation\":<1]",
            "color": { "a": 1, "rgb": 10066329 }
        },
        {
            "query": "[\"potentiation\":<11]",
            "color": { "a": 1, "rgb": 13855081 }
        },
        {
            "query": "[\"potentiation\":<21]",
            "color": { "a": 1, "rgb": 14645827 }
        },
        {
            "query": "[\"potentiation\":<31]",
            "color": { "a": 1, "rgb": 14399575 }
        },
        {
            "query": "[\"potentiation\":<41]",
            "color": { "a": 1, "rgb": 9681227 }
        },
        {
            "query": "[\"potentiation\":<51]",
            "color": { "a": 1, "rgb": 5425023 }
        },
        {
            "query": "[\"potentiation\":<61]",
            "color": { "a": 1, "rgb": 4304797 }
        },
        {
            "query": "[\"potentiation\":<71]",
            "color": { "a": 1, "rgb": 6466512 }
        },
        {
            "query": "[\"potentiation\":<81]",
            "color": { "a": 1, "rgb": 7575246 }
        },
        {
            "query": "[\"potentiation\":<91]",
            "color": { "a": 1, "rgb": 6911965 }
        },
        {
            "query": "[\"potentiation\":<101]",
            "color": { "a": 1, "rgb": 8543941 }
        }
    ],
    "close": true
} as const; 