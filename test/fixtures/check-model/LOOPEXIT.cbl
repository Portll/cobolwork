       IDENTIFICATION DIVISION.
       PROGRAM-ID. LOOPEXIT.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-K                PIC 9(6).
       01 WS-I                PIC 9(6).
       01 WS-J                PIC 9(6).
       01 MEM-SIZE            PIC 9(6) VALUE 100.
       01 WS-TABLE.
          05 WS-ENTRY         PIC X(10) OCCURS 100.
       PROCEDURE DIVISION.
           ACCEPT WS-K FROM COMMAND-LINE
           PERFORM VARYING WS-I FROM 1 BY 1
                 UNTIL WS-I > WS-K OR WS-I > MEM-SIZE
              MOVE 'X' TO WS-ENTRY(WS-I)
           END-PERFORM
           GOBACK.
