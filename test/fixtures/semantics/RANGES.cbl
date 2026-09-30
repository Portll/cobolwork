       IDENTIFICATION DIVISION.
       PROGRAM-ID. RANGES.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-CODE    PIC X.
          88 CODE-ALNUM   VALUE 'A' THRU '9'.
          88 CODE-LETTER  VALUE 'A' THRU 'Z'.
          88 CODE-DIGIT   VALUE '0' THRU '9'.
       PROCEDURE DIVISION.
           EVALUATE WS-CODE
             WHEN 'a' THRU 'Z'
               CONTINUE
             WHEN '0' THRU '9'
               CONTINUE
           END-EVALUATE
           GOBACK.
