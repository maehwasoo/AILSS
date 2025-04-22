export const DEFAULT_GRAPH_CONFIG = {
    "collapse-filter": false,
    "search": "",
    "showTags": true,
    "showAttachments": false,
    "hideUnresolved": false,
    "showOrphans": true,
    "collapse-color-groups": true,
    "collapse-display": true,
    "showArrow": true,
    "textFadeMultiplier": 0.5,
    "nodeSizeMultiplier": 1,
    "lineSizeMultiplier": 0.7,
    "collapse-forces": true,
    "centerStrength": 0.6,
    "repelStrength": 9,
    "linkStrength": 1,
    "linkDistance": 35,
    "scale": 1.25,

    "localJumps": 1,
    "localBacklinks": true,
    "localForelinks": true,
    "localInterlinks": true,
    
    "colorGroups": [
        {
            "query": "[\"potentiation\":<1]",
            "color": { "a": 1, "rgb": 10066329 }
        },
        {
            "query": "[\"potentiation\":<2]",
            "color": { "a": 1, "rgb": 13855081 }
        },
        {
            "query": "[\"potentiation\":<3]",
            "color": { "a": 1, "rgb": 14645827 }
        },
        {
            "query": "[\"potentiation\":<4]",
            "color": { "a": 1, "rgb": 14399575 }
        },
        {
            "query": "[\"potentiation\":<5]",
            "color": { "a": 1, "rgb": 9681227 }
        },
        {
            "query": "[\"potentiation\":<6]",
            "color": { "a": 1, "rgb": 5425023 }
        },
        {
            "query": "[\"potentiation\":<7]",
            "color": { "a": 1, "rgb": 4304797 }
        },
        {
            "query": "[\"potentiation\":<8]",
            "color": { "a": 1, "rgb": 6466512 }
        },
        {
            "query": "[\"potentiation\":<9]",
            "color": { "a": 1, "rgb": 7575246 }
        },
        {
            "query": "[\"potentiation\":<10]",
            "color": { "a": 1, "rgb": 6911965 }
        },
        {
            "query": "[\"potentiation\":<11]",
            "color": { "a": 1, "rgb": 8543941 }
        }
    ],
    "close": true
} as const; 