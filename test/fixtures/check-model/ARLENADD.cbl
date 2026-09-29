       IDENTIFICATION DIVISION.
       PROGRAM-ID. ARLENADD.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-IN               PIC X(9).
       01 WS-OTHER            PIC X(50).
       01 WS-LEN              PIC 9(4).
       01 WS-J                PIC 9(4).
       01 WS-TABLE.
          05 WS-ENTRY         PIC X(10) OCCURS 50.
       PROCEDURE DIVISION.
           ACCEPT WS-IN FROM COMMAND-LINE
           MOVE WS-IN TO WS-OTHER
           MOVE FUNCTION LENGTH(FUNCTION TRIM(WS-OTHER)) TO WS-LEN
           ADD 100 TO WS-LEN
           PERFORM VARYING WS-J FROM 1 BY 1 UNTIL WS-J > WS-LEN
              MOVE 'X' TO WS-ENTRY(WS-J)
           END-PERFORM
           GOBACK.
