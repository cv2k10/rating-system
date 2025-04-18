erDiagram
    ratings {
        int id PK
        string invoice_number
        string invoice_date
        int customer_id FK
        int service_id FK
        int service_provider_id FK
        string validation_token
        string review_text
        datetime created_at
        datetime submitted_at
        boolean is_submitted
    }
    
    customers {
        int id PK
        string customer_id UK
        string name
        datetime created_at
        datetime updated_at
        boolean is_active
    }
    
    services {
        int id PK
        string name
        datetime created_at
        boolean is_active
    }
    
    service_providers {
        int id PK
        string name
        datetime created_at
        boolean is_active
    }
    
    rating_questions {
        int id PK
        string title
        string question
        int sort_order
        boolean is_active
        datetime created_at
        datetime updated_at
    }
    
    rating_responses {
        int id PK
        int rating_id FK
        int question_id FK
        int rating
        datetime created_at
    }
    
    invoice_config {
        int id PK
        boolean is_manual
        string prefix
        int current_number
        datetime created_at
        datetime updated_at
    }
    
    ratings ||--o{ rating_responses : "has"
    rating_questions ||--o{ rating_responses : "has"
    customers ||--o{ ratings : "receives"
    services ||--o{ ratings : "subject_of"
    service_providers ||--o{ ratings : "performs"