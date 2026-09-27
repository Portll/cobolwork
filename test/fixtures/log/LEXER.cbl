       IDENTIFICATION DIVISION.
       PROGRAM-ID. LEXER.
      * A tokenizer that shows each token it reads.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-EXPR             PIC X(80).
       01 WS-POS              PIC 9(3) VALUE 1.
       01 WS-TOKEN            PIC X(16).
       01 EXP-TOKEN.
          05 EXP-TOKEN-TYPE   PIC X.
          05 EXP-TOKEN-TEXT   PIC X(15).
       PROCEDURE DIVISION.
           DISPLAY "Enter an expression: "
           ACCEPT WS-EXPR
           UNSTRING WS-EXPR DELIMITED BY SPACE INTO WS-TOKEN
               WITH POINTER WS-POS
           MOVE WS-TOKEN TO EXP-TOKEN-TEXT
           DISPLAY "Token: " WS-TOKEN
           DISPLAY EXP-TOKEN
           GOBACK.
